"""Altitude (`alt`) and relief (`rel`) per tile commune, from the IGN RGE ALTI terrain model (Géoplateforme).

No open national table of commune altitudes exists (IGN's Répertoire Géographique des Communes, which had
Z min / Z max / Z chef-lieu, is discontinued; data.gouv.fr only has a departmental table for Isère). So the
values are measured on RGE ALTI (bare-ground terrain model, NGF altitudes) through two official services:

- `alt`: ground altitude at the commune's chef-lieu point (ADMIN EXPRESS `chef_lieu_de_commune` /
  `chef_lieu_d_arrondissement_municipal`, same edition as the boundaries), i.e. where the town hall and
  main settlement are, which is what "the altitude of a commune" usually means. Read from the altimetry
  API (`ALTI_API`). A commune without a chef-lieu point (the six uninhabited "villages morts" of Meuse), or
  whose point has no terrain value, uses the point inside its polygon the build uses for distances.
- `rel`: highest minus lowest RGE ALTI value among the 25 m pixels whose centres fall inside the commune
  polygon, read from the WMS-R raster service as float32 (`WMS_URL`, `x-bil;bits=32`). The service
  resamples RGE ALTI to the requested 25 m grid, so single summits and narrow gorges are slightly
  flattened (Mont Blanc reads 4,775 m instead of 4,806 m): `rel` is a slight underestimate, a hilliness
  hint rather than a surveyed figure. Pixels contaminated by gaps in the model are dropped
  (`mask_gap_contamination`). The ADMIN EXPRESS COG-CARTO polygons are generalised, so pixels along a
  commune border can belong to a neighbour.

WMS-R gap contamination, measured on 2026-11-09 against the altimetry API at the pixels of 101 communes
(coasts, estuaries, borders, quarries, mountains): the service resamples a 5 m level of the model (even
1 m requests repeat 5 m blocks) in which the -99999 of "no value" was averaged in. Fully gap pixels read
below -100 m and are dropped as implausible, but a pixel that holds a sliver of gap reads z - 99999 * w
for some weight w, any value between the ground and -100 m: -94 m on 10 m high quays, a row of
-76..-176 m across 144 m fields along a seam of the model, 63 m too low in a 2 x 2 px hole on a plateau.
It only ever lowers a pixel; it sits on the edge of gap areas (coasts, the national border, seams, up to
2 px thick where the resampling duplicates rows, ramping down over a few pixels), or in small holes inside
valid ground. The API answers the model's value at a point (blended too only right at a gap's edge). Deep
quarries are real values (API agrees): Gorges -79 m, Bouguenais -98 m (its floor reaches -118 m, below
PLAUSIBLE_Z), so no absolute floor can be applied inland.

Altimetry API behaviour measured on 2026-11-06 (only the limits of 5,000 points and 5 requests/second/IP
are documented): requests of up to 30 points return exactly the value of a single-point query wherever
the points are (600 comparisons, 0 differences), but larger requests spread over more than a few
kilometres are answered from a coarser level of the model (tens of metres off in the Alps, and spurious
negative altitudes inland). Chef-lieu points therefore go `POINTS_PER_REQUEST` at a time.

A national measurement takes over an hour on these services, which fail intermittently, so the build
does not run it: `compute` reads the committed table `data/altitude-<boundaries edition date>.csv`
(`python -m settling.layers.altitude [--refresh]` regenerates it, departments cached under
`raw/altitude/`) and calls the services only for communes the table lacks. `--layer-file altitude=PATH`
gives another table of the same format.
"""

from __future__ import annotations

import csv
import hashlib
import logging
import math
import threading
import time
import warnings
from collections import Counter
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import requests
import shapely
from pyproj import Transformer
from scipy import ndimage
from shapely.geometry.base import BaseGeometry

from settling.boundaries import department_of
from settling.layers import Layer, LayerContext, LayerResult, Properties
from settling.sources import SourceError, download, resolve_admin_express

log = logging.getLogger("settling")

ALTI_API = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
ALTI_RESOURCE = "ign_rge_alti_wld"  # "RGE Alti - France entière"
POINTS_PER_REQUEST = 20  # exact up to 30 measured; 40 already wrong when spread nationwide
WMS_URL = "https://data.geopf.fr/wms-r/wms"
WMS_LAYER = "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES"  # "Modèle Numérique de Terrain issu du RGEALTI"
WMS_FORMAT = "image/x-bil;bits=32"  # little-endian float32, row 0 at the top (verified against the API)
RASTER_RES_M = 25
# Plus TILE_MARGIN_PX; the WMS caps WIDTH and HEIGHT at 5010, but 5000 px tiles drew gateway timeouts (504).
RASTER_TILE_PX = 2500
# Seen 2026-11-06: valid GetMaps intermittently answered 400, then 200 when repeated; so the WMS retries 400.
WMS_TRANSIENT_STATUSES = frozenset({400, 429})
RGE_ALTI_DATASET = "https://www.data.gouv.fr/datasets/rge-alti-r"
LICENCE = "Licence Ouverte / Etalab 2.0"
LICENCE_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence"

MIN_REQUEST_INTERVAL_S = 0.25  # across all workers; documented limit: 5 requests per second per IP
WORKERS = 3
# Seen 2026-11-06: instant 400/502 from some back ends, random per request, sometimes for minutes; many
# attempts with growing gaps get through where a few long waits did not.
RETRY_DELAYS_S = (2, 5, 10, 20, 30, 60, 60, 120, 120)
TIMEOUT_S = 300
# Both services answer -99999 outside the model (sea) and the WMS blends it into edge pixels (-99997.6..);
# France's lowest ground is about -3 m (open-pit quarries go lower, -118 m at Bouguenais), Mont Blanc 4,806 m.
PLAUSIBLE_Z = (-100.0, 4900.0)
MIN_PIXELS_FOR_RELIEF = 16  # 1 ha at 25 m
# Gap contamination, see mask_gap_contamination.
SURFACE_RADIUS_PX = 4  # the local surface is fitted over 9 x 9 px (225 m)
MIN_SURFACE_SUPPORT = 6  # pixels for a plane fit
EDGE_DROP_M = 5.0
EDGE_ROUGHNESS = 2.0  # x the rms of the plane fit
PIT_DROP_M = 50.0
PIT_ROUGHNESS = 3.0
THIN_DROP_M = 20.0
SHORE_FLOOR_M = -10.0  # lowest ground next to a gap: foreshore at Dunkirk -8.5 m
CERTAIN_GAP_Z = -1000.0  # at least 1% gap in the pixel
# Each side, so that pixels near a tile edge see the gaps and surface beyond it.
TILE_MARGIN_PX = 2 * SURFACE_RADIUS_PX

# Part of the cache path: results computed another way must not be reused.
METHOD_VERSION = f"chef-lieu-api{POINTS_PER_REQUEST}-wms{RASTER_RES_M}m-edge-v5"

CHEF_LIEU_LAYERS = {
    "chef_lieu_de_commune": "code_insee_de_la_commune",
    "chef_lieu_d_arrondissement_municipal": "code_insee_de_l_arrondissement_municipal",
}
CSV_COLUMNS = ("code_insee", "alt_from", "z_alt", "z_min", "z_max", "pixels", "queried_on")
FROM_CHEF_LIEU = "chef_lieu"
FROM_INNER_POINT = "inner_point"

_TO_WGS84 = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)
_TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)


@dataclass(frozen=True)
class Summary:
    """Terrain values of one commune, in metres."""

    code: str
    alt_from: str | None  # FROM_CHEF_LIEU, FROM_INNER_POINT, or None when no reference point had a value
    z_alt: float | None
    z_min: float | None  # None when fewer than MIN_PIXELS_FOR_RELIEF pixels had a value
    z_max: float | None
    pixels: int | None  # raster pixels inside the commune with a value; None when read from the table
    queried_on: str


def to_l93(geometry: BaseGeometry) -> BaseGeometry:
    return shapely.transform(geometry, lambda xy: np.column_stack(_TO_L93.transform(xy[:, 0], xy[:, 1])))


def l93_to_lonlat(points: np.ndarray) -> np.ndarray:
    lon, lat = _TO_WGS84.transform(points[:, 0], points[:, 1])
    return np.column_stack((lon, lat))


def _plausible(values: np.ndarray) -> np.ndarray:
    low, high = PLAUSIBLE_Z
    return np.where((values >= low) & (values <= high), values, np.nan)


# --- HTTP ---------------------------------------------------------------------------------------------------


class Throttle:
    """Spaces request starts by `interval` seconds across threads."""

    def __init__(self, interval: float, sleep: Callable[[float], None], clock: Callable[[], float]) -> None:
        self.interval, self.sleep, self.clock = interval, sleep, clock
        self.next_start = -math.inf
        self.lock = threading.Lock()

    def wait(self) -> None:
        with self.lock:
            delay = self.next_start - self.clock()
            if delay > 0:
                self.sleep(delay)
            self.next_start = self.clock() + self.interval


def _with_retries(
    send: Callable[[], requests.Response],
    throttle: Throttle,
    sleep: Callable[[float], None],
    transient: frozenset[int] = frozenset({429}),
) -> requests.Response:
    """Retry `transient` statuses, server errors and dropped connections; the last answer is returned as is."""
    for delay in (*RETRY_DELAYS_S, None):
        throttle.wait()
        try:
            response = send()
        except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError):
            # A body cut short (ChunkedEncodingError) is raised by get() itself and is neither of the other two.
            if delay is None:
                raise
            sleep(delay)
            continue
        if (response.status_code in transient or response.status_code >= 500) and delay is not None:
            log.info("altitude: HTTP %d, retrying in %ds", response.status_code, delay)
            sleep(delay)
            continue
        return response
    raise AssertionError("unreachable")


def _expect(response: requests.Response, content_type: str, url: str) -> None:
    actual = response.headers.get("Content-Type", "")
    if response.status_code >= 500:
        response.raise_for_status()  # the service itself failed (its gateway errors are HTML pages too)
    if response.status_code == 403 or actual.startswith("text/html"):
        raise SourceError(
            f"{url}: HTTP {response.status_code} ({actual}). A proxy may be blocking the service; "
            "pass a previous result with --layer-file altitude=PATH."
        )
    response.raise_for_status()
    if not actual.startswith(content_type):
        raise SourceError(f"{url}: expected {content_type}, got {actual}: {response.content[:300]!r}")


# --- altitude at points (altimetry API) ---------------------------------------------------------------------


def query_elevations(
    session: requests.Session,
    lonlat: np.ndarray,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    workers: int = WORKERS,
) -> np.ndarray:
    """Exact terrain altitude of each (lon, lat), NaN where the model has no value."""
    values = np.full(len(lonlat), np.nan)
    throttle = Throttle(MIN_REQUEST_INTERVAL_S, sleep, clock)
    starts = range(0, len(lonlat), POINTS_PER_REQUEST)

    def run(start: int) -> np.ndarray:
        return _query_points(session, lonlat[start:start + POINTS_PER_REQUEST], throttle, sleep)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for start, z in zip(starts, pool.map(run, starts)):
            values[start:start + len(z)] = z
    return _plausible(values)


def _query_points(
    session: requests.Session, batch: np.ndarray, throttle: Throttle, sleep: Callable[[float], None]
) -> np.ndarray:
    body = {
        "lon": "|".join(f"{v:.6f}" for v in batch[:, 0]),
        "lat": "|".join(f"{v:.6f}" for v in batch[:, 1]),
        "resource": ALTI_RESOURCE,
        "delimiter": "|",
        "zonly": "true",
    }
    response = _with_retries(lambda: session.post(ALTI_API, json=body, timeout=TIMEOUT_S), throttle, sleep)
    _expect(response, "application/json", ALTI_API)
    elevations = response.json().get("elevations")
    if not isinstance(elevations, list) or len(elevations) != len(batch):
        got = len(elevations) if isinstance(elevations, list) else type(elevations).__name__
        raise SourceError(f"{ALTI_API}: expected {len(batch)} elevations, got {got}")
    return np.asarray(elevations, dtype=float)


# --- relief from the raster (WMS-R) -------------------------------------------------------------------------


@dataclass(frozen=True)
class Tile:
    """A raster window in Lambert-93, aligned on the RASTER_RES_M grid."""

    left: float
    top: float
    width: int
    height: int

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return (self.left, self.top - self.height * RASTER_RES_M, self.left + self.width * RASTER_RES_M, self.top)


def tiles_covering(bounds: tuple[float, float, float, float], tile_px: int = RASTER_TILE_PX) -> list[Tile]:
    minx, miny, maxx, maxy = bounds
    left = math.floor(minx / RASTER_RES_M) * RASTER_RES_M
    bottom = math.floor(miny / RASTER_RES_M) * RASTER_RES_M
    width = math.ceil((maxx - left) / RASTER_RES_M)
    height = math.ceil((maxy - bottom) / RASTER_RES_M)
    top = bottom + height * RASTER_RES_M
    return [
        Tile(left + col * RASTER_RES_M, top - row * RASTER_RES_M, min(tile_px, width - col), min(tile_px, height - row))
        for row in range(0, height, tile_px)
        for col in range(0, width, tile_px)
    ]


def fetch_tile(
    session: requests.Session, tile: Tile, throttle: Throttle, sleep: Callable[[float], None] = time.sleep
) -> np.ndarray:
    """(height, width) terrain altitudes of the tile's pixels, NaN where the model has no value or the
    pixel is contaminated by a gap; fetched with a TILE_MARGIN_PX margin so that pixels near the tile
    edge are judged with the gaps and ground beyond it."""
    m = TILE_MARGIN_PX
    margin = Tile(tile.left - m * RASTER_RES_M, tile.top + m * RASTER_RES_M, tile.width + 2 * m, tile.height + 2 * m)
    return mask_gap_contamination(_fetch_raster(session, margin, throttle, sleep))[m:-m, m:-m]


def mask_gap_contamination(raw: np.ndarray) -> np.ndarray:
    """Raw WMS values with NaN where the model has no value (implausible) or the pixel may hold a gap.

    Gap contamination (module docstring) only lowers a pixel, by any amount, and comes from a gap in or
    next to its footprint. So a pixel is judged against ground around it that no gap can have lowered,
    and only where a gap can be:
    - seeds: pixels without a plausible value; pixels below SHORE_FLOOR_M next to a certain gap (below
      CERTAIN_GAP_Z; no ground next to the sea or the border lies that low, while a quarry floor below
      PLAUSIBLE_Z reads just under -100 m, so its walls are not taken for a shore); interior holes:
      pixels lower than every pixel 2 to 4 px away and more than max(PIT_DROP_M, PIT_ROUGHNESS x rms)
      below the plane through those pixels. A natural closed hollow under 75 m across that deep is rare
      (avens); a real quarry floor at Chailloué reads 27 m below such a plane, and 30 m already cut into it.
    - edges, repeatedly until none is added: a pixel next to a rejected one is rejected when it lies more
      than max(EDGE_DROP_M, EDGE_ROUGHNESS x rms) below the least-squares plane through the clean pixels
      of its 9 x 9 window on the side away from the rejected ones: the slope extrapolated from clean
      ground, so a shore at the foot of a slope, or the wall of a pit around a rejected floor, stays
      (a plane across both sides of a hollow would pass above it). Clean means touching no rejected
      pixel, which keeps contaminated twins (edges 2 px thick) out of the reference. In strips too narrow
      for a plane (jetties, islets), a pixel is rejected with no valid neighbour or THIN_DROP_M below its
      highest one.
    Measured on 101 communes against the API on 2026-11-09: commune minima within 3 m of the
    API-verified value in 100 (Piana stays 5 m low), z_max unchanged; 272 of the 273 pixels more than 3 m
    below the verified minimum are dropped. 0.05% of the pixels are dropped, about half of them legit steep
    coast next to the sea, locally indistinguishable from contamination; that moved no commune minimum up.
    """
    z = _plausible(raw.astype(float))
    next_to_gap = ndimage.binary_dilation(raw < CERTAIN_GAP_Z, _EIGHT)
    with np.errstate(invalid="ignore"):
        z[next_to_gap & (z < SHORE_FLOOR_M)] = np.nan
    rejected = np.isnan(z) | _interior_holes(z)
    while True:
        near_rejected = ndimage.binary_dilation(rejected, _EIGHT)
        rows, cols = np.nonzero(near_rejected & ~rejected)
        if not len(rows):
            break
        # outside the array counts as rejected: the tile margin
        rejected_around = np.nan_to_num(_gather(rejected.astype(float), rows, cols, _NEIGHBOURS), nan=1.0)
        towards_rejected = rejected_around.T @ _NEIGHBOURS
        away_side = _WINDOW @ towards_rejected.T <= 0
        surface, rms, fitted = _plane_at(np.where(near_rejected, np.nan, z), rows, cols, away_side)
        values = z[rows, cols]
        below_surface = fitted & (values < surface - np.maximum(EDGE_DROP_M, EDGE_ROUGHNESS * rms))
        highest = _highest_neighbour(np.where(rejected, np.nan, z), rows, cols)
        # NaN highest (no valid neighbour) compares False, so the negation rejects it
        thin = ~fitted & ~(values >= highest - THIN_DROP_M)
        new = below_surface | thin
        if not new.any():
            break
        rejected[rows[new], cols[new]] = True
    return np.where(rejected, np.nan, z)


def _interior_holes(z: np.ndarray) -> np.ndarray:
    radius = SURFACE_RADIUS_PX
    ring = np.ones((2 * radius + 1, 2 * radius + 1), dtype=bool)
    ring[radius - 1:radius + 2, radius - 1:radius + 2] = False
    valid = ~np.isnan(z)
    lowest_around = ndimage.minimum_filter(np.where(valid, z, np.inf), footprint=ring, mode="constant", cval=np.inf)
    rows, cols = np.nonzero(valid & (z < lowest_around))
    holes = np.zeros(z.shape, dtype=bool)
    if len(rows):
        in_ring = (np.abs(_WINDOW).max(axis=1) > 1)[:, None]
        surface, rms, fitted = _plane_at(z, rows, cols, in_ring)
        hole = fitted & (z[rows, cols] < surface - np.maximum(PIT_DROP_M, PIT_ROUGHNESS * rms))
        holes[rows[hole], cols[hole]] = True
    return holes


def _offsets(radius: int) -> np.ndarray:
    span = range(-radius, radius + 1)
    return np.array([(dr, dc) for dr in span for dc in span if (dr, dc) != (0, 0)])


_EIGHT = np.ones((3, 3), dtype=bool)
_NEIGHBOURS = _offsets(1)
_WINDOW = _offsets(SURFACE_RADIUS_PX)


def _plane_at(
    z: np.ndarray, rows: np.ndarray, cols: np.ndarray, use: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Least-squares plane through the non-NaN pixels of the _WINDOW around each (row, col) for which
    `use` (len(_WINDOW), 1 or len(rows)) holds: (plane at the pixel, rms residual, fit possible)."""
    values = _gather(z, rows, cols, _WINDOW)
    weight = ~np.isnan(values) & use
    values = np.where(weight, values, 0.0)
    design = np.column_stack([np.ones(len(_WINDOW)), _WINDOW])
    normal = np.einsum("kn,ki,kj->nij", weight, design, design)
    count = weight.sum(axis=0)
    fitted = (count >= MIN_SURFACE_SUPPORT) & (np.abs(np.linalg.det(normal)) > 1e-6)  # not all on one line
    coef = np.zeros((len(rows), 3))
    coef[fitted] = np.linalg.solve(normal[fitted], (values.T @ design)[fitted][..., None])[..., 0]
    residual = np.where(weight, values - design @ coef.T, 0.0)
    rms = np.sqrt((residual**2).sum(axis=0) / np.maximum(count - 3, 1))
    return coef[:, 0], rms, fitted


def _highest_neighbour(z: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN neighbourhoods
        return np.nanmax(_gather(z, rows, cols, _NEIGHBOURS), axis=0)


def _gather(z: np.ndarray, rows: np.ndarray, cols: np.ndarray, offsets: np.ndarray) -> np.ndarray:
    """(len(offsets), len(rows)) values of z at each (row, col) + offset, NaN outside the array."""
    pad = int(np.abs(offsets).max())
    padded = np.pad(z, pad, constant_values=np.nan)
    return padded[rows[None, :] + pad + offsets[:, :1], cols[None, :] + pad + offsets[:, 1:]]


def _fetch_raster(
    session: requests.Session, tile: Tile, throttle: Throttle, sleep: Callable[[float], None]
) -> np.ndarray:
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": WMS_LAYER,
        "STYLES": "",
        "CRS": "EPSG:2154",
        "BBOX": ",".join(f"{v:.0f}" for v in tile.bbox),
        "WIDTH": tile.width,
        "HEIGHT": tile.height,
        "FORMAT": WMS_FORMAT,
    }
    response = _with_retries(
        lambda: session.get(WMS_URL, params=params, timeout=TIMEOUT_S), throttle, sleep, WMS_TRANSIENT_STATUSES
    )
    _expect(response, "image/x-bil", WMS_URL)  # a WMS error is an XML document with HTTP 200
    expected = tile.width * tile.height * 4
    if len(response.content) != expected:
        raise SourceError(f"{WMS_URL}: expected {expected} bytes for {tile}, got {len(response.content)}")
    return np.frombuffer(response.content, dtype="<f4").reshape(tile.height, tile.width)


class RangeAccumulator:
    """Running min, max and pixel count of each polygon over the tiles it overlaps."""

    def __init__(self, polygons_l93: list[BaseGeometry]) -> None:
        self.polygons = polygons_l93
        for polygon in polygons_l93:
            shapely.prepare(polygon)
        self.bounds = shapely.bounds(np.asarray(polygons_l93, dtype=object)).reshape(-1, 4)
        self.low = np.full(len(polygons_l93), np.inf)
        self.high = np.full(len(polygons_l93), -np.inf)
        self.count = np.zeros(len(polygons_l93), dtype=np.int64)

    def add(self, tile: Tile, z: np.ndarray) -> None:
        for i, polygon in enumerate(self.polygons):
            minx, miny, maxx, maxy = self.bounds[i]
            c0 = max(0, math.floor((minx - tile.left) / RASTER_RES_M))
            c1 = min(tile.width, math.ceil((maxx - tile.left) / RASTER_RES_M))
            r0 = max(0, math.floor((tile.top - maxy) / RASTER_RES_M))
            r1 = min(tile.height, math.ceil((tile.top - miny) / RASTER_RES_M))
            if c0 >= c1 or r0 >= r1:
                continue
            xs = tile.left + (np.arange(c0, c1) + 0.5) * RASTER_RES_M
            ys = tile.top - (np.arange(r0, r1) + 0.5) * RASTER_RES_M
            gx, gy = np.meshgrid(xs, ys)
            values = z[r0:r1, c0:c1][shapely.contains_xy(polygon, gx, gy)]
            values = values[~np.isnan(values)]
            if values.size:
                self.low[i] = min(self.low[i], float(values.min()))
                self.high[i] = max(self.high[i], float(values.max()))
                self.count[i] += values.size


# --- per-department measurement and cache -------------------------------------------------------------------


def measure(
    session: requests.Session,
    codes: list[str],
    geometries: list[BaseGeometry],
    chef_lieux: dict[str, tuple[float, float]],
    inner_points_l93: np.ndarray,
    queried_on: str,
) -> list[Summary]:
    """Altitude at the reference points (API) and relief over the polygons (raster) of these communes."""
    inner = l93_to_lonlat(inner_points_l93) if len(codes) else np.empty((0, 2))
    has_chef_lieu = np.array([code in chef_lieux for code in codes], dtype=bool)
    reference = np.array([chef_lieux.get(code, (np.nan, np.nan)) for code in codes], dtype=float).reshape(-1, 2)
    reference[~has_chef_lieu] = inner[~has_chef_lieu]
    z_alt = query_elevations(session, reference)
    retry = has_chef_lieu & np.isnan(z_alt)  # chef-lieu at sea or outside the model: fall back
    if retry.any():
        z_alt[retry] = query_elevations(session, inner[retry])
    from_chef_lieu = has_chef_lieu & ~retry

    polygons = [to_l93(geometry) for geometry in geometries]
    ranges = RangeAccumulator(polygons)
    throttle = Throttle(MIN_REQUEST_INTERVAL_S, time.sleep, time.monotonic)
    if polygons:
        bounds = shapely.total_bounds(np.asarray(polygons, dtype=object))
        for tile in tiles_covering(tuple(bounds)):
            ranges.add(tile, fetch_tile(session, tile, throttle))

    summaries = []
    for i, code in enumerate(codes):
        known = not math.isnan(z_alt[i])
        enough = ranges.count[i] >= MIN_PIXELS_FOR_RELIEF
        summaries.append(Summary(
            code=code,
            alt_from=(FROM_CHEF_LIEU if from_chef_lieu[i] else FROM_INNER_POINT) if known else None,
            z_alt=float(z_alt[i]) if known else None,
            z_min=float(ranges.low[i]) if enough else None,
            z_max=float(ranges.high[i]) if enough else None,
            pixels=int(ranges.count[i]),
            queried_on=queried_on,
        ))
    return summaries


def to_properties(codes: Iterable[str], summaries: dict[str, Summary]) -> Properties:
    properties: Properties = {}
    for code in codes:
        summary = summaries.get(code)
        if summary is None:
            continue
        props: dict[str, int] = {}
        if summary.z_alt is not None:
            props["alt"] = round(summary.z_alt)
        if summary.z_min is not None and summary.z_max is not None:
            props["rel"] = round(summary.z_max) - round(summary.z_min)
        if props:
            properties[code] = props
    return properties


def write_summaries(path: Path, summaries: Iterable[Summary]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    with partial.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_COLUMNS)
        for s in sorted(summaries, key=lambda s: s.code):
            writer.writerow([s.code, s.alt_from or "", _fmt(s.z_alt), _fmt(s.z_min), _fmt(s.z_max), s.pixels, s.queried_on])
    partial.replace(path)


def read_summaries(path: Path) -> dict[str, Summary]:
    with path.open(encoding="utf-8", newline="") as f:
        rows = csv.DictReader(f)
        missing = set(CSV_COLUMNS) - set(rows.fieldnames or [])
        if missing:
            raise SourceError(f"{path}: missing columns {sorted(missing)}, expected {list(CSV_COLUMNS)}")
        return {
            row["code_insee"]: Summary(
                code=row["code_insee"],
                alt_from=row["alt_from"] or None,
                z_alt=_parse(row["z_alt"]),
                z_min=_parse(row["z_min"]),
                z_max=_parse(row["z_max"]),
                pixels=int(row["pixels"]),
                queried_on=row["queried_on"],
            )
            for row in rows
            if row["code_insee"]
        }


def _fmt(value: float | None) -> str:
    return "" if value is None else f"{value:.2f}"


def _parse(text: str) -> float | None:
    return float(text) if text.strip() else None


def read_chef_lieux(paths: dict[str, Path]) -> dict[str, tuple[float, float]]:
    """INSEE code -> (lon, lat) of the chef-lieu, from the ADMIN EXPRESS point layers."""
    found: dict[str, tuple[float, float]] = {}
    for layer, code_column in CHEF_LIEU_LAYERS.items():
        table = pq.read_table(paths[layer], columns=[code_column, "geometrie"])
        points = shapely.from_wkb(np.asarray(table["geometrie"].to_pylist(), dtype=object))
        for code, x, y in zip(table[code_column].to_pylist(), shapely.get_x(points), shapely.get_y(points)):
            if code and not math.isnan(x):
                found[code] = (float(x), float(y))
    return found


def fetch_chef_lieux(session: requests.Session, raw: Path) -> tuple[str, dict[str, Path]]:
    edition = resolve_admin_express(session)
    base = edition.files["commune"].rsplit("/", 1)[0]
    paths = {}
    for layer in CHEF_LIEU_LAYERS:
        paths[layer] = raw / "admin-express" / edition.edition_id / f"{layer}.parquet"
        download(session, f"{base}/{layer}.parquet", paths[layer], expected_size=None, override_flag="--layer-file")
    return edition.edition_id, paths


def measured_by_department(
    ctx: LayerContext, indices: list[int] | None = None, refresh: bool = False
) -> tuple[dict[str, Summary], str]:
    """Measure the communes at `indices` (all by default) on the IGN services, one department at a time.

    Whole departments are cached under raw/altitude/<edition>/<method>/<dep>.csv and reused unless
    `refresh`; a subset (communes missing from the committed table) is measured without cache."""
    edition_id, chef_lieu_paths = fetch_chef_lieux(ctx.session, ctx.raw)
    chef_lieux = read_chef_lieux(chef_lieu_paths)
    cache_dir = ctx.raw / "altitude" / edition_id / METHOD_VERSION
    whole = indices is None
    by_dep: dict[str, list[int]] = {}
    for i in range(len(ctx.codes)) if indices is None else indices:
        by_dep.setdefault(department_of(ctx.codes[i]), []).append(i)
    summaries: dict[str, Summary] = {}
    for dep, members in sorted(by_dep.items()):
        path = cache_dir / f"{dep}.csv"
        cached = read_summaries(path) if whole and path.exists() and not refresh else {}
        if any(ctx.codes[i] not in cached for i in members):
            started = time.perf_counter()
            measured = measure(
                ctx.session,
                [ctx.codes[i] for i in members],
                [ctx.communes[i].geometry for i in members],
                chef_lieux,
                ctx.origins[members],
                datetime.now(UTC).date().isoformat(),
            )
            if whole:
                write_summaries(path, measured)
            cached = {s.code: s for s in measured}
            log.info("altitude: department %s measured (%d communes) in %.0fs", dep, len(members), time.perf_counter() - started)
        summaries |= cached
    return summaries, edition_id


# --- committed table ----------------------------------------------------------------------------------------

# The national result, committed so the release build does not spend an hour on a flaky service:
# data/altitude-<boundaries edition date>.csv, regenerated with `python -m settling.layers.altitude --refresh`.
TABLE_DIR = Path(__file__).resolve().parent / "data"
TABLE_COLUMNS = ("code_insee", "z_alt", "z_min", "z_max", "alt_from")
TABLE_ALT_FROM = {FROM_CHEF_LIEU: "c", FROM_INNER_POINT: "i"}
MIN_TABLE_SHARE = 0.999  # of the tile communes; less means the table belongs to another boundaries edition


@dataclass(frozen=True)
class Table:
    path: Path
    meta: dict[str, str]  # from the '# key: value' header lines
    summaries: dict[str, Summary]


def committed_table_path() -> Path | None:
    """The newest committed table (file names sort by boundaries edition date)."""
    tables = sorted(TABLE_DIR.glob("altitude-*.csv"))
    return tables[-1] if tables else None


def write_table(path: Path, summaries: Iterable[Summary], meta: dict[str, str]) -> None:
    """Deterministic: header lines in the given order, rows sorted by code; altitude to 0.01 m, range in m."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    with partial.open("w", encoding="utf-8", newline="") as f:
        for key, value in meta.items():
            f.write(f"# {key}: {value}\n")
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(TABLE_COLUMNS)
        for s in sorted(summaries, key=lambda s: s.code):
            known = s.z_min is not None and s.z_max is not None
            z_min, z_max = (round(s.z_min), round(s.z_max)) if known else ("", "")
            writer.writerow([s.code, _fmt(s.z_alt), z_min, z_max, TABLE_ALT_FROM.get(s.alt_from or "", "")])
    partial.replace(path)


def read_table(path: Path) -> Table:
    meta: dict[str, str] = {}
    body: list[str] = []
    with path.open(encoding="utf-8", newline="") as f:
        for line in f:
            if line.startswith("#"):
                key, _, value = line[1:].partition(":")
                meta[key.strip()] = value.strip()
            else:
                body.append(line)
    rows = csv.DictReader(body)
    missing = set(TABLE_COLUMNS) - set(rows.fieldnames or [])
    if missing:
        raise SourceError(f"{path}: missing columns {sorted(missing)}, expected {list(TABLE_COLUMNS)}")
    alt_from = {short: long for long, short in TABLE_ALT_FROM.items()}
    summaries = {
        row["code_insee"]: Summary(
            code=row["code_insee"],
            alt_from=alt_from.get(row["alt_from"]),
            z_alt=_parse(row["z_alt"]),
            z_min=_parse(row["z_min"]),
            z_max=_parse(row["z_max"]),
            pixels=None,
            queried_on=meta.get("queried_on", ""),
        )
        for row in rows
        if row["code_insee"]
    }
    return Table(path, meta, summaries)


def chef_lieu_altitudes(path: Path | None = None) -> dict[str, float]:
    """INSEE code -> exact RGE ALTI ground altitude (m, NGF) at the commune's chef-lieu, or at the
    `ctx.origins` point for a commune without one (alt_from 'i'), from the committed table."""
    path = path or committed_table_path()
    if path is None:
        return {}
    return {code: s.z_alt for code, s in read_table(path).summaries.items() if s.z_alt is not None}


def from_former_communes(code: str, former: list[str], summaries: dict[str, Summary]) -> Summary | None:
    """Relief of a commune nouvelle missing from the table, as the union of its former communes' ranges
    (exact when they tile it); its altitude stays unknown, no chef-lieu value can be taken from them."""
    ranges = [summaries[old] for old in former if old in summaries and summaries[old].z_min is not None]
    if not former or len(ranges) != len(former):
        return None
    low = min(s.z_min for s in ranges if s.z_min is not None)
    high = max(s.z_max for s in ranges if s.z_max is not None)
    return Summary(code, None, None, low, high, None, ranges[0].queried_on)


def _fill_missing(ctx: LayerContext, summaries: dict[str, Summary], missing: list[str]) -> dict[str, str]:
    """Measure communes absent from the table on the IGN services; if that fails, take the relief of their
    former communes. Returns code -> how it was filled ('api', 'former_communes' or 'none')."""
    log.warning("altitude: %d communes not in the table, measuring them: %s", len(missing), missing[:20])
    index = {code: i for i, code in enumerate(ctx.codes)}
    try:
        measured, _ = measured_by_department(ctx, [index[code] for code in missing])
    except (SourceError, requests.RequestException) as error:
        log.warning("altitude: IGN services failed (%s); falling back to former communes", error)
        measured = {}
    summaries |= measured
    former: dict[str, list[str]] = {}
    for old, new in ctx.merged_codes.items():
        former.setdefault(new, []).append(old)
    filled = {}
    for code in missing:
        union = None if code in measured else from_former_communes(code, sorted(former.get(code, [])), summaries)
        if code in measured:
            filled[code] = "api"
        elif union is not None:
            summaries[code], filled[code] = union, "former_communes"
        else:
            filled[code] = "none"
    return filled


# --- layer --------------------------------------------------------------------------------------------------


def compute(ctx: LayerContext) -> LayerResult:
    """Values from the committed table (or --layer-file altitude=PATH, same format); the IGN services are
    called only for communes the table lacks."""
    path = ctx.overrides.get("altitude") or committed_table_path()
    if path is None:
        raise SourceError(f"no altitude table in {TABLE_DIR}; run python -m settling.layers.altitude --refresh")
    table = read_table(path)
    summaries = dict(table.summaries)
    missing = [code for code in ctx.codes if code not in summaries]
    filled = _fill_missing(ctx, summaries, missing) if missing else {}
    properties = to_properties(ctx.codes, summaries)
    source = {
        "name": "IGN RGE ALTI (Géoplateforme altimetry API and WMS-R)",
        "alt": {"api": ALTI_API, "resource": ALTI_RESOURCE, "points_per_request": POINTS_PER_REQUEST},
        "rel": {"wms": WMS_URL, "layer": WMS_LAYER, "format": WMS_FORMAT, "resolution_m": RASTER_RES_M},
        "dataset": RGE_ALTI_DATASET,
        "licence": LICENCE,
        "licence_url": LICENCE_URL,
        "table": path.name,
        "queried_on": table.meta.get("queried_on"),
        "reference_points": table.meta.get("boundaries"),
        "method": table.meta.get("method"),
        "sha256": _sha256([path]),
    }
    report = _report(ctx.codes, summaries, properties) | {
        "table_rows": len(table.summaries),
        "not_in_table": dict(sorted(Counter(filled.values()).items())),
        "not_in_table_codes": sorted(filled)[:50],
    }
    return LayerResult(properties, source, report)


def _sha256(files: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _report(codes: list[str], summaries: dict[str, Summary], properties: Properties) -> dict:
    report: dict = {
        "communes": len(codes),
        "alt_present": sum("alt" in p for p in properties.values()),
        "rel_present": sum("rel" in p for p in properties.values()),
        "alt_from": dict(sorted(Counter(summaries[c].alt_from or "none" for c in codes if c in summaries).items())),
        "missing_alt": [c for c in codes if "alt" not in properties.get(c, {})][:50],
        "missing_rel": [c for c in codes if "rel" not in properties.get(c, {})][:50],
    }
    for prop in ("alt", "rel"):
        values = np.array([p[prop] for p in properties.values() if prop in p])
        if len(values):
            report[f"{prop}_quantiles"] = {
                f"p{round(q * 100)}": int(np.quantile(values, q)) for q in (0.0, 0.1, 0.5, 0.9, 0.99, 1.0)
            }
    return report


# Spot checks against values read on 2026-11-06; bounds leave room for a moved chef-lieu point.
SPOT_CHECKS: dict[str, tuple[str, str, int, int]] = {
    "74056": ("Chamonix-Mont-Blanc", "alt", 950, 1150),
    "05023": ("Briançon", "alt", 1150, 1450),
    "75104": ("Paris 4e", "alt", 25, 50),
    "69382": ("Lyon 2e", "alt", 150, 190),
    "59183": ("Dunkerque", "alt", -5, 20),
    "23096": ("Guéret", "alt", 380, 500),
}
# Relief: the Mont Blanc massif must show thousands of metres, central Paris and Dunkirk almost none.
# Then gap contamination (mask_gap_contamination) on a quay, a coast and fields, read 2026-11-09 against the
# altimetry API (the method v4 gave 234, 113 and 111), and a real quarry 79 m below sea level that must stay.
RELIEF_CHECKS: dict[str, tuple[str, int, int]] = {
    "74056": ("Chamonix-Mont-Blanc", 2500, 3900),
    "75104": ("Paris 4e", 0, 30),
    "59183": ("Dunkerque", 0, 60),
    "76595": ("Saint-Jouin-Bruneval", 125, 160),
    "17369": ("Saint-Martin-de-Ré", 15, 35),
    "03003": ("Ainay-le-Château", 55, 80),
    "44064": ("Gorges", 115, 140),
}


def table_problems(communes: dict[str, dict], path: Path | None = None) -> list[str]:
    """The committed table must cover the tile communes: else it belongs to another boundaries edition."""
    path = path or committed_table_path()
    if path is None:
        return [f"no committed table in {TABLE_DIR}"]
    if not communes:
        return []
    rows = read_table(path).summaries
    present = sum(code in rows for code in communes)
    if present / len(communes) < MIN_TABLE_SHARE:
        return [
            f"{path.name} covers {present}/{len(communes)} tile communes (< {MIN_TABLE_SHARE:.1%}); "
            "regenerate it for the current boundaries: python -m settling.layers.altitude --refresh"
        ]
    return []


def gate(communes: dict[str, dict]) -> list[str]:
    problems = table_problems(communes)
    checks = [(code, name, prop, low, high) for code, (name, prop, low, high) in SPOT_CHECKS.items()]
    checks += [(code, name, "rel", low, high) for code, (name, low, high) in RELIEF_CHECKS.items()]
    for code, name, prop, low, high in checks:
        if code not in communes:
            continue  # outside the departments of this build
        value = communes[code].get(prop)
        if value is None:
            problems.append(f"{name} ({code}) has no {prop}")
        elif not low <= value <= high:
            problems.append(f"{name} ({code}) {prop}={value}, expected {low}..{high}")
    return problems


LAYER = Layer(
    name="altitude",
    fields={
        "alt": "ground altitude at the chef-lieu (town hall area) in metres, IGN RGE ALTI",
        "rel": "relief: highest minus lowest ground altitude within the commune on a 25 m grid, metres",
    },
    compute=compute,
    ranges={"alt": (-10, 4810), "rel": (0, 4810)},
    min_coverage={"alt": 0.999, "rel": 0.999},
    gate=gate,
)


# --- regenerating the committed table -----------------------------------------------------------------------


def main(argv: list[str] | None = None) -> None:
    """Measure every metropolitan commune on the IGN services and write data/altitude-<edition date>.csv."""
    import argparse

    import truststore

    from settling import proximity
    from settling.boundaries import load_boundaries
    from settling.sources import fetch_admin_express

    repo = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(prog="python -m settling.layers.altitude", description=main.__doc__)
    parser.add_argument("--refresh", action="store_true", help="re-measure every department, ignoring the raw cache")
    parser.add_argument("--raw", type=Path, default=repo / "data" / "raw", help="download cache directory")
    parser.add_argument("--out", type=Path, help="output file (default: the committed table of the edition)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    truststore.inject_into_ssl()  # TLS-inspecting proxies install their root CA in the OS store
    session = requests.Session()
    session.headers["User-Agent"] = "settling-map-pipeline"
    edition, paths = fetch_admin_express(session, args.raw)
    boundaries = load_boundaries(paths, None)  # metropolitan France and Corsica
    ctx = LayerContext(
        session=session,
        raw=args.raw,
        communes=boundaries.communes,
        merged_codes=boundaries.merged_codes,
        origins=proximity.representative_points_l93([a.geometry for a in boundaries.communes]),
    )
    summaries, edition_id = measured_by_department(ctx, refresh=args.refresh)
    dates = sorted({s.queried_on for s in summaries.values()})
    meta = {
        "source": f"IGN RGE ALTI: alt = altimetry API {ALTI_API} ({ALTI_RESOURCE}) at the chef-lieu, "
                  f"z_min/z_max = WMS-R {WMS_URL} {WMS_LAYER} at {RASTER_RES_M} m",
        "licence": f"{LICENCE} ({LICENCE_URL}); {RGE_ALTI_DATASET}",
        "boundaries": edition_id,
        "queried_on": dates[0] if len(dates) == 1 else f"{dates[0]}..{dates[-1]}",
        "method": METHOD_VERSION,
        "columns": "code_insee; z_alt m at the chef-lieu (alt_from c) or the inner point (i); z_min, z_max m",
    }
    out = args.out or TABLE_DIR / f"altitude-{edition.edition_date}.csv"
    write_table(out, summaries.values(), meta)
    log.info("wrote %s: %d communes, %d bytes", out, len(summaries), out.stat().st_size)


if __name__ == "__main__":
    main()
