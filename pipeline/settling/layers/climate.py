"""Sunshine (`sun`) and hot days (`hot`) per commune, interpolated from Météo-France station normals 1991-2020.

Source: Météo-France "Fiches climatologiques" on data.gouv.fr (Licence Ouverte 2.0): one `.data` text sheet
per station with its 1991-2020 statistics, re-edited monthly. Two annual values are read:
- "Durée d'insolation (Moyenne en heures)": annual sunshine duration, hours;
- "Nombre moyen de jours avec / Tx >= 30°C": mean number of days per year with a maximum >= 30 °C.
A section carries "Statistiques établies sur la période YYYY-YYYY" when the station's record is shorter. A
value is used only if its period lies within 1991-2020 and spans at least `MIN_YEARS` years: a short, recent
period would overstate hot days in a warming climate.

Climate is measured at stations, not in communes, so every commune value is an interpolation:
- target point: the commune's chef-lieu (ADMIN EXPRESS `chef_lieu_de_commune` /
  `chef_lieu_d_arrondissement_municipal`, same edition as the boundaries), where people live; else the point
  inside the polygon the build uses for distances (`ctx.origins`). Its ground altitude comes from the IGN
  RGE ALTI altimetry API. The inner point is a poor fallback in mountains (it can sit on a glacier).
- effective distance: sqrt(horizontal² + (VERTICAL_SCALE × altitude difference)²), so a station 100 m higher
  or lower counts as 20 km farther. Temperature falls by about 0.65 °C per 100 m (standard lapse rate), which
  shifts hot-day counts far more than 20 km of plain does. No lapse-rate correction is applied to the values;
  stations at a similar altitude are preferred instead, and the cutoff excludes very different altitudes.
- value: inverse-square-distance mean over the `NEIGHBOURS` nearest stations whose effective distance is
  at most the property's cutoff (`CUTOFF_KM`). With no station within the cutoff, the value is absent.
- `cd`: kilometres (horizontal, rounded) from the target point to the nearest contributing station; when
  both values are present, the larger of the two. It is the uncertainty hint shown with the values.

Overseas communes are absent: the Lambert-93 geometry used here is metropolitan.

`h50` is a PROJECTION, not a measurement: mean number of days per year with a maximum >= 30 °C "around 2050"
under France's reference warming trajectory TRACC (PNACC-3: +1.5 / +2 / +3 °C worldwide in 2030 / 2050 /
2100, that is +2 / +2.7 / +4 °C for mainland France and Corsica, per Météo-France's README_TRACC). Source:
Météo-France TRACC-2023 indicators (DRIAS, Licence Ouverte), member `TRACC_MEMBERS["q50"]` of the pinned archive
`TRACC_URL`: indicator TX30D ("Nombre de jours avec une température maximale ≥ 30 °C", absolute value),
warming level RWL-27 (+2.7 °C), Explore2-2022 regional simulations bias-adjusted by ADAMONT on SAFRAN
(adjustment reference 1980-2011), RCP8.5 used only as a path to the warming level, ensemble median (ENSq50).
"Around 2050" means: for each simulation, the mean over the 20-year window [Y-10, Y+9] centred on the year Y
when that simulation reaches +2.7 °C over France; Y differs between simulations; the median is then taken
across simulations. Values are on the SAFRAN 8 km grid: a commune takes the grid point nearest its target
point (within `TRACC_MAX_KM`), else `h50` is absent. A grid cell stands for its mean altitude, so a valley
chef-lieu in the mountains gets a value representative of higher ground (too few hot days). `h50` and `hot`
come from different sources (model grid against station normals 1991-2020); compare them with care.
Climadiag Commune (Météo-France's per-commune version of the same data) was probed but not used: its CSV
codes indicators as G1..T1 with no definition in the files sampled so far.
On a machine whose proxy blocks `.tar` downloads, `h50` is absent and the source records why; a local copy of
the archive can be given with `--layer-file climate_tracc=PATH` (its sha256 must match `TRACC_SHA256`).

A station table cached by this module (CSV, columns `STATION_COLUMNS`) can be given with
`--layer-file climate=PATH`.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import logging
import math
import re
import statistics
import tarfile
import threading
import time
from collections import Counter
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, fields
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import requests
import shapely
from pyproj import Transformer
from scipy.spatial import cKDTree

from settling.boundaries import OVERSEAS_PREFIX
from settling.layers import Layer, LayerContext, LayerResult, Properties
from settling.sources import SourceError, download, resolve_admin_express

log = logging.getLogger("settling")

DATASET_API = "https://www.data.gouv.fr/api/1/datasets/684c2d56f3861808c0a5d465/"
DATASET_PAGE = "https://www.data.gouv.fr/datasets/fiches-climatologiques"
PUBLISHER = "Météo-France"
LICENCE = "Licence Ouverte / Etalab 2.0"
FICHE_URL = re.compile(r"/FICHECLIM_(\d{8})\.data$")
MAX_FAILED_SHARE = 0.02
OVERSEAS_STATIONS = ("97", "98")

ALTI_API = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
ALTI_RESOURCE = "ign_rge_alti_wld"  # "RGE Alti - France entière"
ALTI_LICENCE = "Licence Ouverte / Etalab 2.0 (IGN RGE ALTI)"
# The API takes up to 5,000 points, but beyond about 45 it reads a coarser terrain level (measured by the
# altitude layer on 2026-11-06; seen here: a 5,000-point batch returned "no value" for coastal chefs-lieux
# such as Nice and Ajaccio, which answer 4.6 m and 10.7 m one by one). Small requests give exact values.
ALTI_POINTS_PER_REQUEST = 40
ALTI_REQUEST_INTERVAL_S = 0.25  # documented limit: 5 requests per second per IP
ALTI_WORKERS = 3
ALTI_RETRY_DELAYS_S = (5, 20, 60)
PLAUSIBLE_Z = (-50.0, 4900.0)  # the API answers -99999 off the terrain model

CHEF_LIEU_LAYERS = {
    "chef_lieu_de_commune": "code_insee_de_la_commune",
    "chef_lieu_d_arrondissement_municipal": "code_insee_de_l_arrondissement_municipal",
}

# Pinned from the GitHub Actions probe of 2026-11-06 (run 42246011372).
TRACC_URL = (
    "https://object.files.data.gouv.fr/meteofrance-drias/TRACC-2023/CSV_wk_032025/"
    "Indicateurs-Absolue_Centiles-Explore2-Climat_Moyenne-20ans_RWL27_csv.tar"
)
TRACC_SIZE = 108_503_040
TRACC_SHA256 = "59f03c86830c7804cf30b11d8095839e5238e73206eb727416d7dafda34c94df"
TRACC_MEMBERS = {
    stat: f"TX30D_yr_RWL-27_TIMEavg_GEOxy_FR-Metro_EXPLORE2-2022_MF-ADAMONT_rcp85_ENS{stat}.csv"
    for stat in ("q50", "min", "max")
}
TRACC_INDICATOR = "TX30D"
TRACC_RWL = "RWL-27"
TRACC_COLUMNS = ["Point", "Latitude", "Longitude", "RWL", "Value"]
TRACC_LICENCE = "Licence Ouverte / Etalab 2.0 (Météo-France, DRIAS)"
TRACC_MAX_KM = 8  # grid spacing; any land point is within 5.7 km of a cell centre
ENSEMBLE_TOLERANCE_DAYS = 0.01
TIMEDELTA = re.compile(r"(-)?(\d+) days (\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)")

NORMALS = (1991, 2020)
MIN_YEARS = 25
NEIGHBOURS = 5
VERTICAL_SCALE = 200.0  # 1 m of altitude difference weighs as 200 m of horizontal distance
# Sunshine stations are ten times fewer (100 against about 1,000) and sunshine varies over larger distances.
CUTOFF_KM = {"sun": 80, "hot": 50}
MIN_DISTANCE_M = 1000.0  # weight floor: a station at the target point does not take all the weight
SUN_STEP_H = 10
# Lambert-93 extent of metropolitan France and Corsica, with a margin (as proximity.L93_BOUNDS).
L93_BOUNDS = (0.0, 6_000_000.0, 1_300_000.0, 7_200_000.0)
WORKERS = 6
TIMEOUT_S = 60
RETRIES = 3
QUANTILES = (0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0)

SUN_TITLE = "Durée d'insolation (Moyenne en heures)"
DAYS_TITLE = "Nombre moyen de jours avec"
HOT_ROW = re.compile(r"^Tx\s*>=\s*30\s*°C\s*;")
PERIOD_LINE = re.compile(r"^Statistiques établies sur la période (\d{4})-(\d{4});")
HEADER = re.compile(
    r"^(?P<name>.*?)\s+Indicatif\s*:\s*(?P<id>\d{8}),\s*alt\s*:\s*(?P<alt>-?\d+)m,\s*"
    r"lat\s*:\s*(?P<lat>\d+°\d+'\d+\"[NS]),\s*lon\s*:\s*(?P<lon>\d+°\d+'\d+\"[EO])"
)
DMS = re.compile(r"(\d+)°(\d+)'(\d+)\"([NSEO])")
EDITED = re.compile(r"Edité le : (\d{2})/(\d{2})/(\d{4})")
ANNUAL_COLUMN = 13  # label, twelve months, year
ZERO = "."  # "donnée égale à 0"; "-" is "donnée manquante"
GZIP_MAGIC = b"\x1f\x8b"

_TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
_TO_WGS84 = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)


@dataclass(frozen=True)
class Station:
    station_id: str
    name: str
    lon: float
    lat: float
    alt: int
    sun: float | None  # annual hours
    sun_from: int | None
    sun_to: int | None
    hot: float | None  # days per year with Tx >= 30 °C
    hot_from: int | None
    hot_to: int | None
    edited: str  # ISO date the sheet was produced


STATION_COLUMNS = tuple(f.name for f in fields(Station))
PROPERTIES = ("sun", "hot")  # interpolated from stations
OUTPUTS = (*PROPERTIES, "cd", "h50")


def normal(station: Station, prop: str) -> float | None:
    """The station's value of `prop` if it is a usable 1991-2020 normal, else None."""
    value, start, end = getattr(station, prop), getattr(station, f"{prop}_from"), getattr(station, f"{prop}_to")
    if value is None or start is None or end is None:
        return None
    within = NORMALS[0] <= start <= end <= NORMALS[1]
    return value if within and end - start + 1 >= MIN_YEARS else None


# --- station sheets ---------------------------------------------------------------------------------------


def parse_fiche(text: str) -> Station | None:
    """One station sheet; None when the header line is not recognised."""
    lines = [line.rstrip() for line in text.splitlines()]
    header = next((m for line in lines[:8] if (m := HEADER.search(line))), None)
    if header is None:
        return None
    edited = next((m for line in lines[:8] if (m := EDITED.search(line))), None)
    sun, (sun_from, sun_to) = _section_annual(lines, SUN_TITLE, row=None)
    hot, (hot_from, hot_to) = _section_annual(lines, DAYS_TITLE, row=HOT_ROW)
    return Station(
        station_id=header["id"],
        name=header["name"].strip(),
        lon=_degrees(header["lon"]),
        lat=_degrees(header["lat"]),
        alt=int(header["alt"]),
        sun=sun,
        sun_from=sun_from if sun is not None else None,
        sun_to=sun_to if sun is not None else None,
        hot=hot,
        hot_from=hot_from if hot is not None else None,
        hot_to=hot_to if hot is not None else None,
        edited=f"{edited[3]}-{edited[2]}-{edited[1]}" if edited else "",
    )


def _section_annual(lines: list[str], title: str, row: re.Pattern | None) -> tuple[float | None, tuple[int, int]]:
    """Annual value of a section and the section's statistics period.

    `row` picks a labelled row (two sections are titled "Nombre moyen de jours avec"); without it the
    section's single unlabelled value row is used.
    """
    for start, line in enumerate(lines):
        if line.rstrip(";").strip() != title:
            continue
        period = NORMALS
        for following in lines[start + 1:]:
            if not following.strip():
                break  # a blank line ends the section
            if match := PERIOD_LINE.match(following):
                period = (int(match[1]), int(match[2]))
                continue
            label = following.split(";", 1)[0].strip()
            if (row is None and label == "") or (row is not None and row.match(following)):
                return _annual(following), period
            if row is None:
                break  # "Données non disponibles"
    return None, NORMALS


def _annual(row: str) -> float | None:
    cells = [cell.strip() for cell in row.split(";")]
    value = cells[ANNUAL_COLUMN] if len(cells) > ANNUAL_COLUMN else ""
    if value == ZERO:
        return 0.0
    try:
        return float(value)
    except ValueError:
        return None


def _degrees(dms: str) -> float:
    match = DMS.fullmatch(dms)
    if match is None:
        raise ValueError(f"not a D°M'S\" coordinate: {dms}")
    value = int(match[1]) + int(match[2]) / 60 + int(match[3]) / 3600
    return -value if match[4] in "SO" else value  # O = ouest


def write_stations(path: Path, stations: list[Station]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    with partial.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=STATION_COLUMNS)
        writer.writeheader()
        writer.writerows(asdict(s) for s in sorted(stations, key=lambda s: s.station_id))
    partial.replace(path)


def read_stations(path: Path) -> list[Station]:
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        missing = set(STATION_COLUMNS) - set(reader.fieldnames or [])
        if missing:
            raise SourceError(f"{path}: station table lacks columns {sorted(missing)}")
        return [_station_from_row(row) for row in reader]


def _station_from_row(row: dict[str, str]) -> Station:
    def optional(key: str, kind: type) -> int | float | None:
        return kind(row[key]) if row[key] != "" else None

    return Station(
        station_id=row["station_id"],
        name=row["name"],
        lon=float(row["lon"]),
        lat=float(row["lat"]),
        alt=int(row["alt"]),
        sun=optional("sun", float),
        sun_from=optional("sun_from", int),
        sun_to=optional("sun_to", int),
        hot=optional("hot", float),
        hot_from=optional("hot_from", int),
        hot_to=optional("hot_to", int),
        edited=row["edited"],
    )


@dataclass(frozen=True)
class FicheIndex:
    last_update: str
    urls: dict[str, str]  # station id -> .data URL


def resolve_fiches(session: requests.Session) -> FicheIndex:
    response = session.get(DATASET_API, timeout=TIMEOUT_S)
    response.raise_for_status()
    dataset = response.json()
    publisher = (dataset.get("organization") or {}).get("name")
    if publisher != PUBLISHER:
        raise SourceError(f"{DATASET_API}: published by {publisher!r}, expected {PUBLISHER}")
    urls = {
        match[1]: resource["url"]
        for resource in dataset["resources"]
        if (match := FICHE_URL.search(resource.get("url", "")))
    }
    if not urls:
        raise SourceError(f"{DATASET_API}: no FICHECLIM_*.data resource")
    return FicheIndex(last_update=dataset.get("last_update", ""), urls=urls)


def fetch_fiches(session: requests.Session, directory: Path, urls: dict[str, str]) -> tuple[list[str], list[str]]:
    """Texts of the sheets (cached in `directory`) and the ids that could not be downloaded."""
    directory.mkdir(parents=True, exist_ok=True)

    def one(item: tuple[str, str]) -> str | None:
        station_id, url = item
        path = directory / f"FICHECLIM_{station_id}.data"
        if not path.exists():
            content = _get_sheet(session, url)
            if content is None:
                return None
            path.write_bytes(content)
        return path.read_text(encoding="utf-8")

    items = sorted(urls.items())
    with ThreadPoolExecutor(WORKERS) as pool:
        texts = list(pool.map(one, items))
    failed = [station_id for (station_id, _), text in zip(items, texts) if text is None]
    return [text for text in texts if text is not None], failed


def _get_sheet(session: requests.Session, url: str) -> bytes | None:
    for attempt in range(RETRIES):
        try:
            with session.get(url, timeout=TIMEOUT_S, stream=True, headers={"Accept-Encoding": "identity"}) as response:
                content = response.raw.read(decode_content=False)
        except requests.RequestException as error:
            log.warning("climate: %s attempt %d: %s", url, attempt + 1, error)
            time.sleep(2 * (attempt + 1))
            continue
        if response.status_code == 200 and not response.headers.get("Content-Type", "").startswith("text/html"):
            return decode_body(content)
        log.warning("climate: %s HTTP %s %s", url, response.status_code, response.headers.get("Content-Type"))
    return None


def decode_body(content: bytes) -> bytes:
    """Some sheets are plain text stored with a `Content-Encoding: gzip` label (seen 2026-11-06 for 10372001,
    13108004, 81192005), so bodies are read raw and only gunzipped when they really are gzip."""
    return gzip.decompress(content) if content[:2] == GZIP_MAGIC else content


# --- target points and altitudes --------------------------------------------------------------------------


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


def fetch_chef_lieux(session: requests.Session, raw: Path) -> tuple[str, dict[str, tuple[float, float]]]:
    edition = resolve_admin_express(session)
    base = edition.files["commune"].rsplit("/", 1)[0]
    paths = {}
    for layer in CHEF_LIEU_LAYERS:
        paths[layer] = raw / "admin-express" / edition.edition_id / f"{layer}.parquet"
        download(session, f"{base}/{layer}.parquet", paths[layer], expected_size=None, override_flag="--layer-file")
    return edition.edition_id, read_chef_lieux(paths)


def target_points(codes: list[str], origins: np.ndarray, chef_lieux: dict[str, tuple[float, float]]) -> tuple[np.ndarray, np.ndarray]:
    """(n, 2) Lambert-93 target points (chef-lieu, else the inner point) and whether each is a chef-lieu."""
    targets = np.asarray(origins, dtype=float).reshape(-1, 2).copy()
    is_chef_lieu = np.array([code in chef_lieux for code in codes], dtype=bool)
    if is_chef_lieu.any():
        lonlat = np.array([chef_lieux[code] for code in codes if code in chef_lieux], dtype=float)
        targets[is_chef_lieu] = np.column_stack(_TO_L93.transform(lonlat[:, 0], lonlat[:, 1]))
    return targets, is_chef_lieu


class _Throttle:
    """At most one request start per `interval` seconds across threads."""

    def __init__(self, interval: float, sleep: Callable[[float], None]) -> None:
        self._interval, self._sleep = interval, sleep
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            start = max(now, self._next)
            self._next = start + self._interval
        if start > now:
            self._sleep(start - now)


def query_altitudes(session: requests.Session, lonlat: np.ndarray, sleep: Callable[[float], None] = time.sleep) -> np.ndarray:
    """Ground altitude of each (lon, lat), NaN where the terrain model has no value."""
    throttle = _Throttle(ALTI_REQUEST_INTERVAL_S, sleep)

    def one(start: int) -> np.ndarray:
        batch = lonlat[start:start + ALTI_POINTS_PER_REQUEST]
        body = {
            "lon": "|".join(f"{v:.6f}" for v in batch[:, 0]),
            "lat": "|".join(f"{v:.6f}" for v in batch[:, 1]),
            "resource": ALTI_RESOURCE,
            "delimiter": "|",
            "zonly": "true",
        }
        for delay in (*ALTI_RETRY_DELAYS_S, None):
            throttle.wait()
            try:
                response = session.post(ALTI_API, json=body, timeout=TIMEOUT_S)
                if response.status_code == 200:
                    elevations = response.json()["elevations"]
                    if len(elevations) != len(batch):
                        raise SourceError(f"{ALTI_API}: {len(elevations)} elevations for {len(batch)} points")
                    return np.asarray(elevations, dtype=float)
                problem = f"HTTP {response.status_code}"
            except requests.RequestException as error:
                problem = str(error)
            if delay is None:
                raise SourceError(f"{ALTI_API}: {problem} for points from {start}")
            log.warning("climate: altimetry %s, retrying in %ss", problem, delay)
            sleep(delay)
        raise AssertionError("unreachable")

    with ThreadPoolExecutor(ALTI_WORKERS) as pool:
        parts = list(pool.map(one, range(0, len(lonlat), ALTI_POINTS_PER_REQUEST)))
    values = np.concatenate(parts) if parts else np.empty(0)
    low, high = PLAUSIBLE_Z
    values[(values < low) | (values > high)] = np.nan
    return values


def cached_altitudes(session: requests.Session, raw: Path, codes: list[str], lonlat: np.ndarray) -> np.ndarray:
    key = ",".join(f"{code}:{x:.5f}:{y:.5f}" for code, (x, y) in zip(codes, lonlat))
    path = raw / "climate" / f"target-altitudes-{ALTI_POINTS_PER_REQUEST}pt-{hashlib.sha1(key.encode()).hexdigest()[:12]}.csv"
    if path.exists():
        with path.open(encoding="utf-8", newline="") as f:
            cached = {row["code_insee"]: float(row["z"]) if row["z"] else math.nan for row in csv.DictReader(f)}
        return np.array([cached.get(code, math.nan) for code in codes])
    values = query_altitudes(session, lonlat)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    with partial.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(("code_insee", "z"))
        writer.writerows((code, "" if math.isnan(z) else f"{z:.1f}") for code, z in zip(codes, values))
    partial.replace(path)
    return values


# --- interpolation ----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Interpolated:
    values: np.ndarray  # NaN where no station is within the cutoff
    nearest_m: np.ndarray  # horizontal metres to the nearest contributing station, NaN where none
    contributors: np.ndarray  # number of contributing stations


def interpolate(station_xyz: np.ndarray, station_values: np.ndarray, target_xyz: np.ndarray, cutoff_m: float) -> Interpolated:
    """Inverse-square-distance mean over the NEIGHBOURS nearest stations within `cutoff_m`, in the effective
    distance space (x, y, VERTICAL_SCALE * z). Targets with an unknown coordinate get no value."""
    n = len(target_xyz)
    values, nearest = np.full(n, np.nan), np.full(n, np.nan)
    counts = np.zeros(n, dtype=np.int64)
    valid = ~np.isnan(target_xyz).any(axis=1)
    if len(station_xyz) == 0 or not valid.any():
        return Interpolated(values, nearest, counts)
    k = min(NEIGHBOURS, len(station_xyz))
    scale = np.array([1.0, 1.0, VERTICAL_SCALE])
    targets = target_xyz[valid]
    distances, indices = cKDTree(station_xyz * scale).query(targets * scale, k=k, distance_upper_bound=cutoff_m)
    distances, indices = distances.reshape(len(targets), k), indices.reshape(len(targets), k)
    found = np.isfinite(distances)
    safe = np.where(found, indices, 0)  # missing neighbours come back as index len(stations)
    weights = np.where(found, 1.0 / np.maximum(distances, MIN_DISTANCE_M) ** 2, 0.0)
    total = weights.sum(axis=1)
    has = total > 0
    weighted = (weights * station_values[safe]).sum(axis=1)
    offsets = station_xyz[safe][:, :, :2] - targets[:, None, :2]
    horizontal = np.where(found, np.hypot(offsets[:, :, 0], offsets[:, :, 1]), np.inf).min(axis=1)
    values[valid] = np.where(has, weighted / np.where(has, total, 1.0), np.nan)
    nearest[valid] = np.where(has, horizontal, np.nan)
    counts[valid] = found.sum(axis=1)
    return Interpolated(values, nearest, counts)


def round_half_up(value: float, step: int = 1) -> int:
    return int(math.floor(value / step + 0.5) * step)


def to_properties(codes: list[str], sun: Interpolated, hot: Interpolated) -> Properties:
    properties: Properties = {}
    for i, code in enumerate(codes):
        props: dict[str, int] = {}
        distances = []
        if not math.isnan(sun.values[i]):
            props["sun"] = round_half_up(sun.values[i], SUN_STEP_H)
            distances.append(sun.nearest_m[i])
        if not math.isnan(hot.values[i]):
            props["hot"] = round_half_up(hot.values[i])
            distances.append(hot.nearest_m[i])
        if props:
            props["cd"] = round_half_up(max(distances) / 1000)
            properties[code] = props
    return properties


def add_projection(properties: Properties, codes: list[str], h50: np.ndarray) -> None:
    """Add the rounded `h50` projection in place; NaN stays absent."""
    for code, value in zip(codes, h50):
        if not math.isnan(value):
            properties.setdefault(code, {})["h50"] = round_half_up(value)


# --- TRACC projection (h50) -------------------------------------------------------------------------------


@dataclass(frozen=True)
class TraccGrid:
    point: np.ndarray  # grid point id (shared by the files of one archive)
    lon: np.ndarray
    lat: np.ndarray
    value: np.ndarray  # days per year; only points with a value are kept


def tracc_days(text: str) -> float:
    """A TRACC day count. The CSVs write it as a pandas timedelta ("6 days 08:23:59.991760256" = 6.35 days,
    seen in every TX30D file of the probe); plain numbers and "nan" are accepted too."""
    match = TIMEDELTA.fullmatch(text.strip())
    if match:
        sign = -1.0 if match[1] else 1.0
        return sign * (int(match[2]) + int(match[3]) / 24 + int(match[4]) / 1440 + float(match[5]) / 86400)
    try:
        return float(text)  # "nan" included
    except ValueError:
        raise SourceError(f"TRACC value {text!r} is neither a number nor a timedelta") from None


def parse_tracc_csv(text: str) -> TraccGrid:
    """Grid points with a value; checks indicator, warming level, columns and the RWL of every row."""
    lines = text.splitlines()
    comments = [line for line in lines if line.startswith("#")]
    if not any(TRACC_INDICATOR in line and "30 °C" in line for line in comments):
        raise SourceError(f"TRACC file does not describe {TRACC_INDICATOR} (days with Tx >= 30 °C)")
    if not any("RWL" in line and "2.7" in line for line in comments):
        raise SourceError("TRACC file is not for the +2.7 °C warming level")
    start = next((i for i, line in enumerate(lines) if line.startswith("Point;")), None)
    if start is None or lines[start].rstrip(";").split(";") != TRACC_COLUMNS:
        raise SourceError(f"TRACC file columns differ from {TRACC_COLUMNS}")
    rows = []
    for line in lines[start + 1:]:
        if not line.strip():
            continue
        point, lat, lon, rwl, value = line.rstrip(";").split(";")
        if rwl != TRACC_RWL:
            raise SourceError(f"TRACC row for {rwl}, expected {TRACC_RWL}")
        days = tracc_days(value)
        if not math.isnan(days):
            rows.append((int(point), float(lon), float(lat), days))
    if not rows:
        raise SourceError("TRACC file has no value")
    point, lon, lat, value = (np.asarray(column) for column in zip(*rows))
    return TraccGrid(point.astype(np.int64), lon.astype(float), lat.astype(float), value.astype(float))


def read_tracc_members(tar_path: Path) -> dict[str, str]:
    """Statistic -> text of its TX30D member, read from the archive without extracting it to disk."""
    with tarfile.open(tar_path) as tar:
        by_name = {Path(m.name).name: m for m in tar.getmembers() if m.isfile()}
        missing = sorted(set(TRACC_MEMBERS.values()) - by_name.keys())
        if missing:
            raise SourceError(f"{tar_path.name} lacks members {missing}")
        return {stat: tar.extractfile(by_name[name]).read().decode("utf-8") for stat, name in TRACC_MEMBERS.items()}


def check_ensemble_order(grids: dict[str, TraccGrid]) -> list[str]:
    """The in-file "Modele" labels do not match the file names (the ENSq50 file says "MAX de l'ensemble", the
    ENSmax file "MEAN"), while the values seen follow the names (min < q50 < max). Every point is checked."""
    median = grids["q50"]
    problems = []
    for stat, sign in (("min", 1), ("max", -1)):
        other = dict(zip(grids[stat].point.tolist(), grids[stat].value.tolist()))
        if set(other) != set(median.point.tolist()):
            problems.append(f"ENS{stat} and ENSq50 cover different grid points")
            continue
        bound = np.array([other[p] for p in median.point.tolist()])
        wrong = int((sign * (median.value - bound) < -ENSEMBLE_TOLERANCE_DAYS).sum())
        if wrong:
            problems.append(f"ENSq50 is {'below ENSmin' if sign == 1 else 'above ENSmax'} at {wrong} grid points")
    return problems


def tracc_archive(ctx: LayerContext) -> Path:
    """Path of the verified archive: `--layer-file climate_tracc=PATH`, else the cached download."""
    path = ctx.overrides.get("climate_tracc")
    if path is None:
        path = ctx.raw / "climate" / "tracc" / TRACC_URL.rsplit("/", 1)[-1]
        download(ctx.session, TRACC_URL, path, expected_size=TRACC_SIZE, override_flag="--layer-file climate_tracc")
    digest = _file_sha256(path)
    if digest != TRACC_SHA256:
        raise SourceError(f"{path}: sha256 {digest} differs from the pinned {TRACC_SHA256}; review the new edition")
    return path


def nearest_grid_values(grid: TraccGrid, targets_l93: np.ndarray, max_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Value of the nearest grid point within `max_m` of each target, and its distance in metres
    (NaN beyond the distance or for a NaN target)."""
    grid_xy = np.column_stack(_TO_L93.transform(grid.lon, grid.lat))
    values, distances = np.full(len(targets_l93), np.nan), np.full(len(targets_l93), np.nan)
    valid = ~np.isnan(targets_l93).any(axis=1)
    if valid.any():
        found_distance, index = cKDTree(grid_xy).query(targets_l93[valid], k=1, distance_upper_bound=max_m)
        found = np.isfinite(found_distance)
        safe = np.where(found, index, 0)
        values[valid] = np.where(found, grid.value[safe], np.nan)
        distances[valid] = np.where(found, found_distance, np.nan)
    return values, distances


def tracc_h50(ctx: LayerContext, targets: np.ndarray, in_scope: np.ndarray) -> tuple[np.ndarray, dict, dict]:
    """`h50` (float days, NaN where absent) per target point, its provenance and report."""
    source = {
        "url": TRACC_URL, "member": TRACC_MEMBERS["q50"], "sha256": TRACC_SHA256, "size": TRACC_SIZE,
        "licence": TRACC_LICENCE, "indicator": "TX30D, days with Tx >= 30 °C, absolute value",
        "warming_level": "RWL-27: +2.7 °C over mainland France (TRACC 2050)",
        "window": "per simulation, 20 years [Y-10, Y+9] around the year Y it reaches +2.7 °C",
        "ensemble": "median (ENSq50, by file name) of Explore2-2022 ADAMONT RCP8.5 simulations",
        "grid": f"SAFRAN 8 km, nearest point within {TRACC_MAX_KM} km of the target point",
    }
    try:
        texts = read_tracc_members(tracc_archive(ctx))
    except SourceError as error:
        if "proxy may be blocking" not in str(error):
            raise
        log.warning("climate: h50 unavailable: %s", error)
        return np.full(len(targets), np.nan), source | {"unavailable": str(error)}, {}
    grids = {stat: parse_tracc_csv(text) for stat, text in texts.items()}
    problems = check_ensemble_order(grids)
    if problems:
        raise SourceError(f"TRACC ensemble statistics inconsistent: {problems}")
    grid = grids["q50"]
    scoped = np.where(in_scope[:, None], targets, np.nan)
    values, distances = nearest_grid_values(grid, scoped, TRACC_MAX_KM * 1000.0)
    present = distances[~np.isnan(distances)]
    report = {
        "grid_points_with_value": len(grid.value),
        "grid_distance_km": {f"p{round(q * 100)}": round(float(np.quantile(present, q)) / 1000, 1) for q in QUANTILES}
        if len(present) else {},
    }
    return values, source, report


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --- layer ------------------------------------------------------------------------------------------------


def _stations(ctx: LayerContext) -> tuple[list[Station], dict]:
    override = ctx.overrides.get("climate")
    if override is not None:
        return read_stations(override), {"station_table": str(override)}
    index = resolve_fiches(ctx.session)
    month = datetime.now(UTC).strftime("%Y-%m")
    table = ctx.raw / "climate" / f"stations-{month}.csv"
    failed: list[str] = []
    if not table.exists():
        texts, failed = fetch_fiches(ctx.session, ctx.raw / "climate" / f"fiches-{month}", index.urls)
        if len(failed) > MAX_FAILED_SHARE * len(index.urls):
            raise SourceError(f"climate: {len(failed)} of {len(index.urls)} station sheets failed, e.g. {failed[:5]}")
        stations = [station for text in texts if (station := parse_fiche(text)) is not None]
        if len(stations) != len(texts):
            log.warning("climate: %d sheets without a recognised header", len(texts) - len(stations))
        write_stations(table, stations)
    return read_stations(table), {
        "dataset_last_update": index.last_update,
        "sheets_listed": len(index.urls),
        "sheets_failed": failed,
        "station_table": table.name,
    }


def _metropolitan_stations(stations: list[Station]) -> tuple[list[Station], np.ndarray]:
    """Stations of metropolitan France and Corsica and their (x, y, altitude), Lambert-93 metres."""
    candidates = [s for s in stations if not s.station_id.startswith(OVERSEAS_STATIONS)]
    if not candidates:
        return [], np.empty((0, 3))
    xy = np.column_stack(_TO_L93.transform([s.lon for s in candidates], [s.lat for s in candidates]))
    inside = _in_metropole(xy)
    kept = [s for s, keep in zip(candidates, inside) if keep]
    return kept, np.column_stack((xy[inside], [s.alt for s in kept])).reshape(-1, 3)


def compute(ctx: LayerContext) -> LayerResult:
    stations, fetched = _stations(ctx)
    metro, station_xyz = _metropolitan_stations(stations)
    edition_id, chef_lieux = fetch_chef_lieux(ctx.session, ctx.raw)

    codes = ctx.codes
    targets, is_chef_lieu = target_points(codes, ctx.origins, chef_lieux)
    in_scope = _in_metropole(targets) & np.array([not code.startswith(OVERSEAS_PREFIX) for code in codes], dtype=bool)
    altitudes = np.full(len(codes), np.nan)
    scope = np.flatnonzero(in_scope)
    if len(scope):
        lonlat = np.column_stack(_TO_WGS84.transform(targets[scope, 0], targets[scope, 1]))
        altitudes[scope] = cached_altitudes(ctx.session, ctx.raw, [codes[i] for i in scope], lonlat)
    target_xyz = np.column_stack((targets, altitudes))  # NaN altitude (out of scope or unknown): no value

    results: dict[str, Interpolated] = {}
    used: dict[str, int] = {}
    for prop in PROPERTIES:
        values = np.array([np.nan if (v := normal(s, prop)) is None else v for s in metro], dtype=float)
        usable = ~np.isnan(values)
        results[prop] = interpolate(station_xyz[usable], values[usable], target_xyz, CUTOFF_KM[prop] * 1000.0)
        used[prop] = int(usable.sum())
    properties = to_properties(codes, results["sun"], results["hot"])
    h50, tracc_source, tracc_report = tracc_h50(ctx, targets, in_scope)
    add_projection(properties, codes, h50)

    edited = sorted({s.edited for s in stations if s.edited})
    source = {
        "dataset": DATASET_PAGE,
        "api": DATASET_API,
        "publisher": PUBLISHER,
        "licence": LICENCE,
        "normals": f"{NORMALS[0]}-{NORMALS[1]}",
        "sheets_edited": f"{edited[0]}..{edited[-1]}" if edited else None,
        "stations_sha256": _stations_sha256(stations),
        "target_points": {"chef_lieu_edition": edition_id, "fallback": "ctx.origins"},
        "altitude": {"api": ALTI_API, "resource": ALTI_RESOURCE, "licence": ALTI_LICENCE},
        "method": {
            "weights": "inverse square of the effective distance",
            "neighbours": NEIGHBOURS,
            "cutoff_km": CUTOFF_KM,
            "vertical_scale": VERTICAL_SCALE,
            "min_years": MIN_YEARS,
        },
        "h50_projection": tracc_source,
    } | fetched
    report = {
        "stations": len(stations),
        "stations_metropole": len(metro),
        "stations_used": used,
        "stations_short_period": {
            prop: sum(getattr(s, prop) is not None and normal(s, prop) is None for s in metro) for prop in PROPERTIES
        },
        "communes": len(codes),
        "communes_in_scope": int(in_scope.sum()),
        "targets_chef_lieu": int((is_chef_lieu & in_scope).sum()),
        "targets_without_altitude": int((in_scope & np.isnan(altitudes)).sum()),
        "coverage": {prop: sum(prop in p for p in properties.values()) for prop in OUTPUTS},
        "quantiles": _quantiles(properties),
        "contributors": {
            prop: dict(sorted(Counter(results[prop].contributors[in_scope].tolist()).items())) for prop in PROPERTIES
        },
        "h50": tracc_report,
    }
    return LayerResult(properties=properties, source=source, report=report)


def _stations_sha256(stations: list[Station]) -> str:
    rows = "\n".join(",".join(str(v) for v in asdict(s).values()) for s in sorted(stations, key=lambda s: s.station_id))
    return hashlib.sha256(rows.encode()).hexdigest()


def _in_metropole(xy: np.ndarray) -> np.ndarray:
    xmin, ymin, xmax, ymax = L93_BOUNDS
    return (xy[:, 0] >= xmin) & (xy[:, 0] <= xmax) & (xy[:, 1] >= ymin) & (xy[:, 1] <= ymax)


def _quantiles(properties: Properties) -> dict[str, dict[str, int]]:
    summary = {}
    for prop in OUTPUTS:
        values = np.array([p[prop] for p in properties.values() if prop in p])
        if len(values):
            summary[prop] = {f"p{round(q * 100)}": int(np.quantile(values, q, method="nearest")) for q in QUANTILES}
    return summary


# --- gate -------------------------------------------------------------------------------------------------

# code -> property -> inclusive bounds. Each centre is the 1991-2020 normal of the city's own Météo-France
# station read on the sheets of 2026-11-06 (sun hours, hot days); the margin leaves room for interpolation.
# Communes absent from the tiles (department builds) are skipped.
SPOT_CHECKS: dict[str, dict[str, tuple[int, int]]] = {
    "06088": {"sun": (2650, 2870)},  # Nice 2,760.5 h
    "13201": {"sun": (2790, 3000)},  # Marseille, from Marignane 2,897.6 h
    "66136": {"sun": (2380, 2600)},  # Perpignan 2,488.6 h
    "2A004": {"sun": (2690, 2910)},  # Ajaccio 2,801.7 h
    "29019": {"sun": (1450, 1660), "hot": (0, 3)},  # Brest-Guipavas 1,554.6 h, 0.8 d
    "59350": {"sun": (1520, 1730), "hot": (3, 11)},  # Lille-Lesquin 1,627.4 h, 6.8 d
    "67482": {"sun": (1640, 1850), "hot": (13, 24)},  # Strasbourg-Entzheim 1,747.3 h, 18.4 d
    "75114": {"sun": (1610, 1820), "hot": (10, 18)},  # Paris-Montsouris 1,717.0 h, 14.0 d
    "30189": {"hot": (48, 68)},  # Nîmes-Courbessac
    "31555": {"hot": (27, 39)},  # Toulouse-Blagnac 33.1 d
    "69029": {"hot": (25, 36)},  # Lyon-Bron 30.6 d
    "74056": {"hot": (0, 8)},  # Chamonix (about 1,040 m)
}
SUNNY_DEPARTMENTS = ("06", "13", "66", "83")
DULL_DEPARTMENTS = ("29", "59", "62")
MIN_SUNSHINE_GAP_H = 700
# National build of 2026-11-06: sun 94.7%, hot 99.6% of 34,788 communes. Department builds only get the
# loose `min_coverage` floors: mountain departments legitimately lack stations (sun: 2B 39%, 2A 40%,
# 06 48%, 66 57%, 23 61%; hot: 2B 82%, 66 86%).
NATIONAL_MIN_COMMUNES = 30_000
# h50 is absent where the proxy blocks the archive, so it has no department floor; nationally (CI) it must be there.
NATIONAL_MIN_COVERAGE = {"sun": 0.9, "hot": 0.98, "h50": 0.97}
# A +2.7 °C projection below today's station normal is possible locally (grid cell against station, model
# against measurement), but must stay rare. To be confirmed by .github/workflows/check-tracc.yml.
MIN_SHARE_H50_NOT_BELOW_HOT = 0.9
MEDITERRANEAN = ("13", "30", "34", "84")
BRITTANY = ("22", "29", "35", "56")
MIN_H50_GAP_DAYS = 20


def gate(communes: dict[str, dict]) -> list[str]:
    problems = _projection_problems(communes)
    if len(communes) >= NATIONAL_MIN_COMMUNES:
        for prop, least in NATIONAL_MIN_COVERAGE.items():
            share = sum(prop in c for c in communes.values()) / len(communes)
            if share < least:
                problems.append(f"{prop} present for {share:.1%} of communes nationally, expected at least {least:.0%}")
    for code, bounds in SPOT_CHECKS.items():
        if code not in communes:
            continue
        for prop, (low, high) in bounds.items():
            value = communes[code].get(prop)
            if value is None or not low <= value <= high:
                problems.append(f"{code}.{prop} = {value}, expected {low}..{high}")
    sunny = _median(communes, "sun", SUNNY_DEPARTMENTS)
    dull = _median(communes, "sun", DULL_DEPARTMENTS)
    if sunny is not None and dull is not None and sunny - dull < MIN_SUNSHINE_GAP_H:
        problems.append(f"median sunshine {SUNNY_DEPARTMENTS} {sunny} h is not {MIN_SUNSHINE_GAP_H} h above {DULL_DEPARTMENTS} {dull} h")
    orphans = [code for code, props in communes.items() if ("sun" in props or "hot" in props) and "cd" not in props]
    if orphans:
        problems.append(f"{len(orphans)} communes have a climate value without station distance cd, e.g. {orphans[:3]}")
    return problems


def _projection_problems(communes: dict[str, dict]) -> list[str]:
    problems = []
    both = [c for c in communes.values() if "h50" in c and "hot" in c]
    if len(both) >= 20:
        share = sum(c["h50"] >= c["hot"] for c in both) / len(both)
        if share < MIN_SHARE_H50_NOT_BELOW_HOT:
            problems.append(f"h50 >= hot for only {share:.1%} of communes, expected at least {MIN_SHARE_H50_NOT_BELOW_HOT:.0%}")
    south = _median(communes, "h50", MEDITERRANEAN)
    west = _median(communes, "h50", BRITTANY)
    if south is not None and west is not None and south - west < MIN_H50_GAP_DAYS:
        problems.append(f"median h50 {MEDITERRANEAN} {south} d is not {MIN_H50_GAP_DAYS} d above {BRITTANY} {west} d")
    return problems


def _median(communes: dict[str, dict], prop: str, departments: tuple[str, ...]) -> float | None:
    values = [c[prop] for code, c in communes.items() if code[:2] in departments and prop in c]
    return statistics.median(values) if len(values) >= 20 else None


LAYER = Layer(
    name="climate",
    fields={
        "sun": "annual sunshine hours, rounded to 10; Météo-France normals 1991-2020 interpolated from stations",
        "hot": "mean days per year with a maximum >= 30 °C; Météo-France normals 1991-2020 interpolated from stations",
        "cd": "km from the chef-lieu to the nearest station used for sun/hot (the larger of the two)",
        "h50": "PROJECTION: mean days per year with a maximum >= 30 °C around 2050 under TRACC (+2.7 °C in France), "
               "median of the Explore2 model ensemble, Météo-France TRACC-2023 on the 8 km grid; not a measurement",
    },
    compute=compute,
    ranges={"sun": (1200, 3100), "hot": (0, 90), "cd": (0, max(CUTOFF_KM.values())), "h50": (0, 150)},
    # floors that every department build passes; the national figure is checked by `gate`
    min_coverage={"sun": 0.3, "hot": 0.75},
    gate=gate,
)
