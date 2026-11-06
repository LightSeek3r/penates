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
  hint rather than a surveyed figure. The ADMIN EXPRESS COG-CARTO polygons are generalised, so pixels
  along a commune border can belong to a neighbour.

Altimetry API behaviour measured on 2026-11-06 (only the limits of 5,000 points and 5 requests/second/IP
are documented): requests of up to 30 points return exactly the value of a single-point query wherever
the points are (600 comparisons, 0 differences), but larger requests spread over more than a few
kilometres are answered from a coarser level of the model (tens of metres off in the Alps, and spurious
negative altitudes inland). Chef-lieu points therefore go `POINTS_PER_REQUEST` at a time.

Results are cached per department under `raw/altitude/`, so a national run is paid once per boundary
edition. A previous result can be given with `--layer-file altitude=PATH` (same CSV columns as the cache).
"""

from __future__ import annotations

import csv
import hashlib
import logging
import math
import threading
import time
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
RASTER_TILE_PX = 2500  # the WMS caps WIDTH and HEIGHT at 5010; 5000 px tiles drew gateway timeouts (504)
# Seen 2026-11-06: a valid GetMap answered 400 once, then 200 when repeated; so 400 is retried for the WMS.
WMS_TRANSIENT_STATUSES = frozenset({400, 429})
RGE_ALTI_DATASET = "https://www.data.gouv.fr/datasets/rge-alti-r"
LICENCE = "Licence Ouverte / Etalab 2.0"
LICENCE_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence"

MIN_REQUEST_INTERVAL_S = 0.25  # across all workers; documented limit: 5 requests per second per IP
WORKERS = 3
RETRY_DELAYS_S = (5, 20, 60)
TIMEOUT_S = 300
# Both services answer -99999 outside the model (sea) and the WMS blends it into edge pixels (-99997.6..);
# France's lowest ground is about -3 m (open-pit quarries go lower), Mont Blanc 4,806 m.
PLAUSIBLE_Z = (-100.0, 4900.0)
MIN_PIXELS_FOR_RELIEF = 16  # 1 ha at 25 m

# Part of the cache path: results computed another way must not be reused.
METHOD_VERSION = f"chef-lieu-api{POINTS_PER_REQUEST}-wms{RASTER_RES_M}m-v3"

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
    pixels: int  # raster pixels inside the commune with a terrain value
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
        except requests.ConnectionError:
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
    """(height, width) terrain altitudes of the tile's pixels, NaN where the model has no value."""
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
    return _plausible(np.frombuffer(response.content, dtype="<f4").reshape(tile.height, tile.width))


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


def measured_by_department(ctx: LayerContext) -> tuple[dict[str, Summary], list[Path], dict]:
    edition_id, chef_lieu_paths = fetch_chef_lieux(ctx.session, ctx.raw)
    chef_lieux = read_chef_lieux(chef_lieu_paths)
    cache_dir = ctx.raw / "altitude" / edition_id / METHOD_VERSION
    by_dep: dict[str, list[int]] = {}
    for i, code in enumerate(ctx.codes):
        by_dep.setdefault(department_of(code), []).append(i)
    summaries: dict[str, Summary] = {}
    files = []
    for dep, indices in sorted(by_dep.items()):
        path = cache_dir / f"{dep}.csv"
        cached = read_summaries(path) if path.exists() else {}
        if any(ctx.codes[i] not in cached for i in indices):
            started = time.perf_counter()
            measured = measure(
                ctx.session,
                [ctx.codes[i] for i in indices],
                [ctx.communes[i].geometry for i in indices],
                chef_lieux,
                ctx.origins[indices],
                datetime.now(UTC).date().isoformat(),
            )
            write_summaries(path, measured)
            cached = {s.code: s for s in measured}
            log.info("altitude: department %s measured (%d communes) in %.0fs", dep, len(indices), time.perf_counter() - started)
        summaries |= cached
        files.append(path)
    reference = {
        "edition_id": edition_id,
        "layers": list(CHEF_LIEU_LAYERS),
        "url": f"https://data.geopf.fr/telechargement/resource/ADMIN-EXPRESS-COG-CARTO-PE/{edition_id}",
    }
    return summaries, files, reference


# --- layer --------------------------------------------------------------------------------------------------


def compute(ctx: LayerContext) -> LayerResult:
    override = ctx.overrides.get("altitude")
    if override is not None:
        summaries, files, reference = read_summaries(override), [override], {"note": "given with --layer-file"}
    else:
        summaries, files, reference = measured_by_department(ctx)
    properties = to_properties(ctx.codes, summaries)
    dates = sorted({summaries[c].queried_on for c in ctx.codes if c in summaries})
    source = {
        "name": "IGN RGE ALTI (Géoplateforme altimetry API and WMS-R)",
        "alt": {"api": ALTI_API, "resource": ALTI_RESOURCE, "points_per_request": POINTS_PER_REQUEST},
        "rel": {"wms": WMS_URL, "layer": WMS_LAYER, "format": WMS_FORMAT, "resolution_m": RASTER_RES_M},
        "dataset": RGE_ALTI_DATASET,
        "licence": LICENCE,
        "licence_url": LICENCE_URL,
        "queried_on": dates[0] if len(dates) == 1 else dates,
        "reference_points": reference,
        "method": METHOD_VERSION,
        "sha256": _sha256(files),
    }
    return LayerResult(properties, source, _report(ctx.codes, summaries, properties))


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
RELIEF_CHECKS: dict[str, tuple[str, int, int]] = {
    "74056": ("Chamonix-Mont-Blanc", 2500, 3900),
    "75104": ("Paris 4e", 0, 30),
    "59183": ("Dunkerque", 0, 60),
}


def gate(communes: dict[str, dict]) -> list[str]:
    problems = []
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
