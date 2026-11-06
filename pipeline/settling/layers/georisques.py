"""Natural-hazard indicators per commune from Géorisques open data: flood zoning, clay shrink-swell, radon
and known underground cavities.

    fl  flood zoning recorded by the State (GASPAR), 0..3
    cl  clay shrink-swell exposure (BRGM 2026 map) reached by at least a quarter of the commune's area, 0..3
    rn  radon potential category (ASNR, arrêté du 27 juin 2018), 1..3
    cv  underground cavities recorded in BDCavités, count

Sources are bulk files only (one GASPAR zip, one radon CSV, one clay shapefile and one cavity CSV per
department), cached under `raw/georisques/`. They are not single files, so this layer takes no
`--layer-file`: a file downloaded by other means is used if saved at the cache path given in the error.

Tile communes are resolved to source codes like `seismic`: a merged commune takes the highest value among
its own code and its former communes (the source describes part of its territory), a Paris/Lyon/Marseille
arrondissement falls back to the parent commune when the source only knows the city. Unknown stays absent.
"""

from __future__ import annotations

import csv
import hashlib
import io
import struct
import zipfile
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import requests
import shapely
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

from settling.boundaries import Area, department_of, locate
from settling.layers import Layer, LayerContext, LayerResult
from settling.seismic import plm_parent

NAME = "georisques"
TIMEOUT_S = 120
CHUNK_BYTES = 1 << 20

GASPAR_URL = "https://files.georisques.fr/GASPAR/gaspar.zip"
GASPAR_LICENCE = "Licence Ouverte v2.0 (Etalab)"
RADON_DATASET_API = "https://www.data.gouv.fr/api/1/datasets/connaitre-le-potentiel-radon-de-ma-commune/"
RADON_LICENCE = "Licence Ouverte v1.0 (data.gouv.fr fr-lo)"
# The "Télécharger" widget of each Géorisques database page reads this listing (key = data-js-base-key).
LISTING_URL = "https://www.georisques.gouv.fr/webappReport/ws/telechargement/{key}"
CLAY_KEY = "alearg_25"  # "Retrait gonflement des argiles - Carte d'exposition (2026)", files dated 2025-11-28
CAVITY_KEY = "cavites"
# Pinned file URLs, used when the listing is unavailable (its gateway answered 404 "no Route matched" for a
# few hours on 2026-11-06). Verified 2026-11-06: the 95 metropolitan clay URLs equal the listing's and
# download directly; Paris has no file (404). The cavity export sits behind the same gateway as the listing.
CLAY_URL = "https://files.georisques.fr/argiles/2025/AleaRG_2025_{dep}_L93.zip"
CLAY_NOT_PUBLISHED = frozenset({"75"})
CAVITY_URL = "https://www.georisques.gouv.fr/webappReport/ws/cavites/departements/{dep}/fiches.csv"
OVERSEAS_PREFIX = "97"
GEORISQUES_LICENCE = "Licence Ouverte v2.0 (Etalab), as stated on georisques.gouv.fr"

# GASPAR PPR rows: "CODE RISQUE 2" 11 = Inondation (all flood types, including submersion marine).
FLOOD_RISK_CODE = "11"
PPR_IN_FORCE = {"Opposable"}  # sous-état Approuvé or Anticipé
PPR_PRESCRIBED = {"Prescrit"}  # sous-état Prescrit or Prorogé; Caduque (abrogé, annulé, déprescrit) is ignored
FLOOD_APPROVED, FLOOD_PRESCRIBED, FLOOD_MAPPED, FLOOD_NONE = 3, 2, 1, 0

RADON_CATEGORIES = range(1, 4)
CLAY_LEVELS = (1, 2, 3)  # shapefile field `niveau`: 1 faible, 2 moyen, 3 fort; unmapped land is "a priori nul"
CLAY_AREA_SHARE = 0.25
# "Pour les départements 75, 78, 91, 92, 93, 94 et 95, les données cavités ne sont pas disponibles sur le
# portail Géorisques" (inventory page, read 2026-11-06); the listing still offers empty files for 91 and 95.
CAVITIES_NOT_ON_GEORISQUES = frozenset({"75", "78", "91", "92", "93", "94", "95"})

_WGS84_TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
_L2E_TO_WGS84 = Transformer.from_crs("EPSG:27572", "EPSG:4326", always_xy=True)


class GeorisquesError(RuntimeError):
    """A Géorisques source could not be fetched or read as expected."""


# --- territory resolution -------------------------------------------------------------------------------

@dataclass(frozen=True)
class Resolution:
    values: dict[str, int]
    by_method: dict[str, int]
    missing: list[str]


def former_communes(merged_codes: dict[str, str]) -> dict[str, list[str]]:
    former: dict[str, list[str]] = {}
    for old, new in merged_codes.items():
        former.setdefault(new, []).append(old)
    return former


def resolve_territories(
    codes: Iterable[str], source: dict[str, int], merged_codes: dict[str, str], known: set[str] | None = None
) -> Resolution:
    """Value per tile commune: the highest among its own code and its former communes, else the PLM parent's.

    `known` (default: the codes of `source`) is the set of codes the source covers; a commune none of whose
    codes is known stays missing, a known code without a value contributes nothing.
    """
    known = set(source) if known is None else known
    former = former_communes(merged_codes)
    values: dict[str, int] = {}
    methods: Counter[str] = Counter()
    missing: list[str] = []
    for code in codes:
        territory = [c for c in [code, *sorted(former.get(code, []))] if c in known]
        parent = plm_parent(code)
        if territory:
            found = [source[c] for c in territory if c in source]
            if territory == [code]:
                method = "own_code"
            else:
                method = "own_and_former_communes" if code in territory else "former_communes"
        elif parent in known:
            found = [source[parent]] if parent in source else []
            method = "plm_parent"
        else:
            missing.append(code)
            continue
        if found:
            values[code] = max(found)
        methods[method] += 1
    return Resolution(values, dict(sorted(methods.items())), missing)


# --- fl: flood zoning from GASPAR ------------------------------------------------------------------------

@dataclass(frozen=True)
class FloodSource:
    classes: dict[str, int]  # INSEE code (GASPAR's COG) -> class 1..3; codes with nothing recorded are absent
    known: set[str]  # every commune code GASPAR lists in any table: absent from `classes` there means 0
    edition: str  # date in the member file names, e.g. 2026-11-02


def read_flood_source(path: Path) -> FloodSource:
    with zipfile.ZipFile(path) as archive:
        members = {name.split("_gaspar_")[0]: name for name in archive.namelist() if "_gaspar_" in name}
        missing = {"pprn", "azi", "ddrm_risq", "catnat"} - set(members)
        if missing:
            raise GeorisquesError(f"{path}: GASPAR archive lacks {sorted(missing)}")
        edition = members["pprn"].rsplit("_", 1)[-1].removesuffix(".csv")
        classes: dict[str, int] = {}
        known: set[str] = set()

        def raise_to(code: str, level: int) -> None:
            if code:
                classes[code] = max(classes.get(code, FLOOD_NONE), level)

        for row in _zip_csv(archive, members["pprn"]):
            code = row["CODE INSEE COMMUNE"]
            known.add(code)
            if row["CODE RISQUE 2"] != FLOOD_RISK_CODE:
                continue
            if row["LIBELLE ETAT"] in PPR_IN_FORCE:
                raise_to(code, FLOOD_APPROVED)
            elif row["LIBELLE ETAT"] in PPR_PRESCRIBED:
                raise_to(code, FLOOD_PRESCRIBED)
        for row in _zip_csv(archive, members["azi"]):
            known.add(row["cod_commune"])
            raise_to(row["cod_commune"], FLOOD_MAPPED)
        for row in _zip_csv(archive, members["ddrm_risq"]):
            known.add(row["cod_commune"])
            if row["num_risque"] == FLOOD_RISK_CODE:
                raise_to(row["cod_commune"], FLOOD_MAPPED)
        known |= {row["code_commune"] for row in _zip_csv(archive, members["catnat"])}
    known.discard("")
    return FloodSource(classes, known, edition)


def _zip_csv(archive: zipfile.ZipFile, member: str) -> Iterator[dict[str, str]]:
    with archive.open(member) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""), delimiter=";")


# --- rn: radon potential ---------------------------------------------------------------------------------

def read_radon(path: Path) -> dict[str, int]:
    categories: dict[str, int] = {}
    with path.open(encoding="utf-8-sig", errors="replace", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            category = _int_or_none(row.get("classe_potentiel"))
            code = (row.get("insee_com") or "").strip()
            if len(code) == 4 and code.isdigit():
                code = "0" + code  # verified: departments 01-09 lost their leading zero ("CORMOZ;AIN;1124")
            if code and category in RADON_CATEGORIES:
                # A few codes appear twice (overseas collectivities); keep the higher category.
                categories[code] = max(categories.get(code, category), category)
    return categories


# --- cl: clay shrink-swell -------------------------------------------------------------------------------

def read_clay_shapefile(path: Path) -> tuple[list[BaseGeometry], list[int]]:
    """Polygons (Lambert-93) and their `niveau` from a BRGM AleaRG zip (.shp + .dbf), without GDAL."""
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        shp = archive.read(_member(names, ".shp", path))
        dbf = archive.read(_member(names, ".dbf", path))
    shapes = list(_shp_polygons(shp))
    levels = [_int_or_none(row.get("niveau")) for row in _dbf_rows(dbf)]
    if len(shapes) != len(levels):
        raise GeorisquesError(f"{path}: {len(shapes)} shapes but {len(levels)} attribute rows")
    kept = [(g, lv) for g, lv in zip(shapes, levels) if g is not None and lv in CLAY_LEVELS]
    return [g for g, _ in kept], [lv for _, lv in kept]


def clay_shares(communes_l93: list[BaseGeometry], polygons: list[BaseGeometry], levels: list[int]) -> np.ndarray:
    """(n, 4) share of each commune's area at exposure 0 (a priori nul), 1, 2 and 3."""
    shares = np.zeros((len(communes_l93), 4))
    if polygons:
        tree = shapely.STRtree(polygons)
        commune_idx, polygon_idx = tree.query(communes_l93, predicate="intersects")
        geoms = np.asarray(communes_l93, dtype=object)
        areas = shapely.area(shapely.intersection(geoms[commune_idx], np.asarray(polygons, dtype=object)[polygon_idx]))
        np.add.at(shares, (commune_idx, np.asarray(levels)[polygon_idx]), areas)
    totals = shapely.area(np.asarray(communes_l93, dtype=object))
    shares[:, 1:] /= np.maximum(totals, 1.0)[:, None]
    shares[:, 1:] = np.minimum(shares[:, 1:], 1.0)
    shares[:, 0] = np.maximum(0.0, 1.0 - shares[:, 1:].sum(axis=1))
    return shares


def clay_class(shares: np.ndarray, least: float = CLAY_AREA_SHARE) -> int:
    """Highest level whose area, together with the higher levels, covers at least `least` of the commune."""
    at_or_above = np.cumsum(shares[::-1])[::-1]  # at_or_above[k] = share of area at level >= k
    return max(level for level in range(4) if level == 0 or at_or_above[level] >= least - 1e-9)


def _member(names: list[str], suffix: str, path: Path) -> str:
    found = [n for n in names if n.lower().endswith(suffix)]
    if len(found) != 1:
        raise GeorisquesError(f"{path}: expected one {suffix} member, found {found}")
    return found[0]


def _shp_polygons(data: bytes) -> Iterator[BaseGeometry | None]:
    """Polygon (5), PolygonZ (15) and PolygonM (25) records; Z/M values are ignored."""
    offset = 100
    while offset + 8 <= len(data):
        (length_words,) = struct.unpack(">i", data[offset + 4:offset + 8])
        content = data[offset + 8:offset + 8 + 2 * length_words]
        offset += 8 + 2 * length_words
        (shape_type,) = struct.unpack("<i", content[:4])
        if shape_type == 0:
            yield None
            continue
        if shape_type not in (5, 15, 25):
            raise GeorisquesError(f"unexpected shapefile shape type {shape_type}")
        n_parts, n_points = struct.unpack("<ii", content[36:44])
        parts = list(struct.unpack(f"<{n_parts}i", content[44:44 + 4 * n_parts])) + [n_points]
        start = 44 + 4 * n_parts
        points = np.frombuffer(content, dtype="<f8", count=2 * n_points, offset=start).reshape(-1, 2)
        yield _polygon_from_rings([points[a:b] for a, b in zip(parts, parts[1:]) if b - a >= 4])


def _polygon_from_rings(rings: list[np.ndarray]) -> BaseGeometry | None:
    """Shapefile rings: clockwise = outer, counter-clockwise = hole of the smallest outer ring holding it."""
    if not rings:
        return None
    linear = [shapely.LinearRing(r) for r in rings]
    shells = [i for i, ring in enumerate(linear) if not shapely.is_ccw(ring)] or list(range(len(linear)))
    holes: dict[int, list[np.ndarray]] = {i: [] for i in shells}
    shell_polygons = {i: Polygon(rings[i]) for i in shells}
    for i, ring in enumerate(linear):
        if i in holes:
            continue
        probe = shapely.Point(rings[i][0])
        owners = [s for s in shells if shell_polygons[s].covers(probe)] or shells
        holes[min(owners, key=lambda s: shell_polygons[s].area)].append(rings[i])
    polygons = [Polygon(rings[i], holes[i]) for i in shells]
    return shapely.make_valid(polygons[0] if len(polygons) == 1 else MultiPolygon(polygons))


def _dbf_rows(data: bytes) -> Iterator[dict[str, str]]:
    n_records, header_len, record_len = struct.unpack("<IHH", data[4:12])
    fields: list[tuple[str, int]] = []
    for pos in range(32, header_len - 1, 32):
        if data[pos] == 0x0D:
            break
        fields.append((data[pos:pos + 11].split(b"\0")[0].decode("ascii"), data[pos + 16]))
    for record in range(n_records):
        offset = header_len + record * record_len
        if data[offset:offset + 1] == b"*":  # deleted record: keep the position aligned with the .shp
            yield {}
            continue
        offset += 1
        row = {}
        for name, size in fields:
            row[name] = data[offset:offset + size].decode("utf-8", "replace").strip()
            offset += size
        yield row


# --- cv: known underground cavities ----------------------------------------------------------------------

@dataclass(frozen=True)
class Cavity:
    record_id: str
    code: str  # numInsee as entered in BDCavités (COG of the time)
    lon: float | None
    lat: float | None


def read_cavities(path: Path) -> list[Cavity]:
    """Rows of a Géorisques BDCavités department export; coordinates are Lambert II étendu (absent if confidential)."""
    cavities = []
    with path.open(encoding="utf-8-sig", errors="replace", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            x, y = _float_or_none(row.get("xouvl2e")), _float_or_none(row.get("youvl2e"))
            lon, lat = _L2E_TO_WGS84.transform(x, y) if x is not None and y is not None else (None, None)
            cavities.append(Cavity(row.get("id") or row.get("numCavite") or "", (row.get("numInsee") or "").strip(), lon, lat))
    return cavities


@dataclass(frozen=True)
class CavityCount:
    counts: dict[str, int]
    by_method: dict[str, int]
    unattributed: int
    unknown_plm_cities: list[str]  # parent codes whose arrondissements stay absent


def count_cavities(
    cavities: Iterable[Cavity], communes: list[Area], merged_codes: dict[str, str], published: set[str]
) -> CavityCount:
    """Cavities per tile commune of a published department (0 when none is recorded).

    Attribution: the recorded INSEE code if it is a tile commune, else its current commune after a merger,
    else (Paris/Lyon/Marseille city code, or an unknown code) the commune containing its coordinates. A city
    with a record that has no coordinates cannot be split by arrondissement: its arrondissements stay absent.
    """
    codes = {a.code for a in communes}
    in_scope = {c for c in codes if department_of(c) in published}
    counts = dict.fromkeys(sorted(in_scope), 0)
    methods: Counter[str] = Counter()
    unattributed = 0
    unknown_cities: set[str] = set()
    to_locate: list[Cavity] = []
    seen: set[str] = set()
    for cavity in cavities:
        if cavity.record_id and cavity.record_id in seen:
            continue
        seen.add(cavity.record_id)
        target = cavity.code if cavity.code in codes else merged_codes.get(cavity.code)
        if target in codes:
            methods["own_code" if target == cavity.code else "former_commune"] += 1
            _add(counts, target, in_scope)
        elif cavity.lon is not None:
            to_locate.append(cavity)
        elif cavity.code in {plm_parent(c) for c in codes if plm_parent(c)}:
            unknown_cities.add(cavity.code)
        else:
            unattributed += 1
    located = locate([(c.lon, c.lat) for c in to_locate], communes) if to_locate else []
    for code in located:
        if code is None:
            unattributed += 1
            continue
        methods["coordinates"] += 1
        _add(counts, code, in_scope)
    for city in unknown_cities:
        for code in [c for c in counts if plm_parent(c) == city]:
            del counts[code]
    return CavityCount(counts, dict(sorted(methods.items())), unattributed, sorted(unknown_cities))


def _add(counts: dict[str, int], code: str, in_scope: set[str]) -> None:
    if code in in_scope:
        counts[code] += 1


# --- fetching --------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Fetched:
    path: Path
    url: str
    sha256: str


def fetch(session: requests.Session, url: str, dest: Path, expected_sha1: str | None = None) -> Fetched:
    """Download once to `dest` (a file already there, e.g. saved by hand behind a proxy, is used as is)."""
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        partial = dest.with_name(dest.name + ".part")
        sha1 = hashlib.sha1()
        try:
            with session.get(url, stream=True, timeout=TIMEOUT_S) as response:
                _raise_for_status(response, url, dest)
                with partial.open("wb") as out:
                    for chunk in response.iter_content(CHUNK_BYTES):
                        out.write(chunk)
                        sha1.update(chunk)
        except requests.RequestException as error:
            raise GeorisquesError(f"{url}: {error}. Download it by other means and save it as {dest}.") from error
        if expected_sha1 and sha1.hexdigest() != expected_sha1:
            raise GeorisquesError(f"{url}: sha1 {sha1.hexdigest()} does not match published {expected_sha1}")
        partial.replace(dest)
    return Fetched(dest, url, _sha256(dest))


def listing(session: requests.Session, key: str) -> dict[str, str | None]:
    """Department code -> download URL (None where Géorisques publishes nothing) of one database."""
    url = LISTING_URL.format(key=key)
    response = session.get(url, params={"anneemin": 2003}, timeout=TIMEOUT_S)
    _raise_for_status(response, url, None)
    departmental = response.json().get("departemental") or {}
    return {label.split(" - ", 1)[0].strip(): (entry or {}).get("lien") for label, entry in departmental.items()}


def department_links(
    session: requests.Session, key: str, template: str, unpublished: frozenset[str], departments: list[str]
) -> tuple[dict[str, str | None], str]:
    """The listing's URL per department, or the pinned URLs if the listing is unavailable (metropolitan only)."""
    try:
        return listing(session, key), "listing"
    except (requests.RequestException, GeorisquesError, ValueError) as error:
        pinned = {
            dep: None if dep in unpublished or dep.startswith(OVERSEAS_PREFIX) else template.format(dep=dep)
            for dep in departments
        }
        return pinned, f"pinned URLs (listing unavailable: {str(error)[:160]})"


def fetch_or_cached(session: requests.Session, url: str, dest: Path) -> tuple[Fetched, str | None]:
    """`fetch`, else the newest copy cached on an earlier day (same file name, sibling day folder).

    Returns the file and, when the cache was used, the day it was downloaded.
    """
    try:
        return fetch(session, url, dest), None
    except GeorisquesError as error:
        earlier = sorted(p for p in dest.parent.parent.glob(f"*/{dest.name}") if p != dest)
        if not earlier:
            raise GeorisquesError(f"{error} No earlier copy is cached under {dest.parent.parent}.") from error
        return Fetched(earlier[-1], url, _sha256(earlier[-1])), earlier[-1].parent.name


def _raise_for_status(response: requests.Response, url: str, dest: Path | None) -> None:
    content_type = response.headers.get("Content-Type", "")
    if response.status_code == 403 or content_type.startswith("text/html"):
        hint = f" Download it by other means and save it as {dest}." if dest else ""
        raise GeorisquesError(f"{url}: HTTP {response.status_code} ({content_type}); a proxy may be blocking it.{hint}")
    response.raise_for_status()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _today() -> str:
    return datetime.now(UTC).date().isoformat()


# --- compute ---------------------------------------------------------------------------------------------

def compute(ctx: LayerContext) -> LayerResult:
    if NAME in ctx.overrides:
        raise GeorisquesError(
            f"{NAME} reads several bulk files and takes no --layer-file; save blocked downloads under {ctx.raw / NAME}"
        )
    cache = ctx.raw / NAME
    codes = ctx.codes
    departments = sorted({department_of(code) for code in codes})
    properties: dict[str, dict[str, int]] = {code: {} for code in codes}

    gaspar = _fetch_or_newest(ctx.session, GASPAR_URL, cache / "gaspar" / f"gaspar-{_today()}.zip", "gaspar-*.zip")
    flood = read_flood_source(gaspar.path)
    flood_values = {code: flood.classes.get(code, FLOOD_NONE) for code in flood.known}
    fl = resolve_territories(codes, flood_values, ctx.merged_codes)
    _put(properties, "fl", fl.values)

    radon_file, radon_meta = _fetch_radon(ctx.session, cache)
    rn = resolve_territories(codes, read_radon(radon_file.path), ctx.merged_codes)
    _put(properties, "rn", rn.values)

    clay_files, clay_report = _clay(ctx, cache, departments, properties)
    cavity_files, cavity_report = _cavities(ctx, cache, departments, properties)

    properties = {code: props for code, props in properties.items() if props}
    report = {
        "communes": len(codes),
        "coverage": {prop: sum(prop in p for p in properties.values()) for prop in LAYER.fields},
        "fl": {"by_class": _distribution(fl.values), "by_method": fl.by_method, "missing": fl.missing[:50],
               "missing_count": len(fl.missing), "gaspar_edition": flood.edition},
        "rn": {"by_class": _distribution(rn.values), "by_method": rn.by_method, "missing": rn.missing[:50],
               "missing_count": len(rn.missing)},
        "cl": clay_report,
        "cv": cavity_report,
    }
    source = {
        "fl": {"name": "GASPAR (procédures administratives relatives aux risques)", "publisher": "Ministère de la "
               "Transition écologique / Géorisques", "url": GASPAR_URL, "licence": GASPAR_LICENCE,
               "edition": flood.edition, "fetched_on": gaspar.path.stem.removeprefix("gaspar-"), "sha256": gaspar.sha256},
        "rn": {"name": "Connaître le potentiel radon de ma commune", "publisher": "ASNR (ex-IRSN)",
               "url": radon_file.url, "licence": RADON_LICENCE, "edition": radon_meta, "sha256": radon_file.sha256},
        "cl": {"name": "Retrait-gonflement des argiles, carte d'exposition 2026 (arrêté du 9 janvier 2026)",
               "publisher": "BRGM / Géorisques", "listing": LISTING_URL.format(key=CLAY_KEY), "licence": GEORISQUES_LICENCE,
               "files": {dep: {"url": f.url, "sha256": f.sha256} for dep, f in clay_files.items()}},
        "cv": {"name": "Inventaire des cavités souterraines (BDCavités)", "publisher": "BRGM / Géorisques",
               "listing": LISTING_URL.format(key=CAVITY_KEY), "licence": GEORISQUES_LICENCE,
               "files": {dep: {"url": f.url, "sha256": f.sha256, "fetched_on": f.path.parent.name}
                         for dep, f in cavity_files.items()}},
    }
    return LayerResult(properties=properties, source=source, report=report)


def _fetch_or_newest(session: requests.Session, url: str, dest: Path, pattern: str) -> Fetched:
    """`fetch`, else the newest file matching `pattern` next to `dest` (an earlier day's download)."""
    try:
        return fetch(session, url, dest)
    except GeorisquesError:
        cached = sorted(dest.parent.glob(pattern))
        if not cached:
            raise
        return Fetched(cached[-1], url, _sha256(cached[-1]))


def _fetch_radon(session: requests.Session, cache: Path) -> tuple[Fetched, str]:
    try:
        response = session.get(RADON_DATASET_API, timeout=TIMEOUT_S)
        _raise_for_status(response, RADON_DATASET_API, None)
    except (requests.RequestException, GeorisquesError) as error:
        cached = sorted((cache / "radon").glob("radon-*.csv"))
        if not cached:
            raise GeorisquesError(f"{RADON_DATASET_API}: {error}; no radon file is cached under {cache / 'radon'}") from error
        return Fetched(cached[-1], RADON_DATASET_API, _sha256(cached[-1])), "cached copy (data.gouv.fr API unavailable)"
    resources = [r for r in response.json()["resources"] if r.get("format") == "csv"]
    if len(resources) != 1:
        raise GeorisquesError(f"{RADON_DATASET_API}: expected one CSV resource, found {[r['title'] for r in resources]}")
    resource = resources[0]
    checksum = resource.get("checksum") or {}
    sha1 = checksum.get("value") if checksum.get("type") == "sha1" else None
    tag = (sha1 or resource["last_modified"].replace(":", ""))[:12]
    fetched = fetch(session, resource["url"], cache / "radon" / f"radon-{tag}.csv", expected_sha1=sha1)
    return fetched, f"resource of {resource['last_modified'][:10]}"


def _clay(
    ctx: LayerContext, cache: Path, departments: list[str], properties: dict[str, dict[str, int]]
) -> tuple[dict[str, Fetched], dict]:
    links, link_source = department_links(ctx.session, CLAY_KEY, CLAY_URL, CLAY_NOT_PUBLISHED, departments)
    files: dict[str, Fetched] = {}
    shares_by_code: dict[str, np.ndarray] = {}
    by_department = _communes_by_department(ctx.communes)
    for dep in departments:
        url = links.get(dep)
        if not url:
            continue
        files[dep] = fetch(ctx.session, url, cache / "argiles" / url.rsplit("/", 2)[-2] / url.rsplit("/", 1)[-1])
        polygons, levels = read_clay_shapefile(files[dep].path)
        communes = by_department[dep]
        shares = clay_shares(_to_l93([a.geometry for a in communes]), polygons, levels)
        for area, row in zip(communes, shares):
            shares_by_code[area.code] = row
            properties[area.code]["cl"] = clay_class(row)
    values = {code: properties[code]["cl"] for code in shares_by_code}
    unpublished = [dep for dep in departments if dep not in files]
    stacked = np.array(list(shares_by_code.values())) if shares_by_code else np.zeros((0, 4))
    report = {
        "links": link_source,
        "rule": f"highest level reached, with the levels above it, by at least {CLAY_AREA_SHARE:.0%} of the commune area",
        "by_class": _distribution(values),
        "departments": len(files),
        "not_published": unpublished,
        "absent_communes": sum(len(by_department[d]) for d in unpublished),
        "mean_share_by_level": [round(float(v), 3) for v in stacked.mean(axis=0)] if len(stacked) else [],
        "communes_with_any_fort": int((stacked[:, 3] > 0).sum()) if len(stacked) else 0,
    }
    return files, report


def _cavities(
    ctx: LayerContext, cache: Path, departments: list[str], properties: dict[str, dict[str, int]]
) -> tuple[dict[str, Fetched], dict]:
    links, link_source = department_links(ctx.session, CAVITY_KEY, CAVITY_URL, CAVITIES_NOT_ON_GEORISQUES, departments)
    day = _today()
    files: dict[str, Fetched] = {}
    cached_from: dict[str, str] = {}
    cavities: list[Cavity] = []
    empty: list[str] = []
    for dep in departments:
        url = links.get(dep)
        if not url or dep in CAVITIES_NOT_ON_GEORISQUES:
            continue
        files[dep], earlier_day = fetch_or_cached(ctx.session, url, cache / "cavites" / day / f"cavites-{dep}.csv")
        if earlier_day:
            cached_from[dep] = earlier_day
        rows = read_cavities(files[dep].path)
        if not rows:
            empty.append(dep)  # header only: nothing published, not "no cavity"
            continue
        cavities.extend(rows)
    published = {dep for dep in files if dep not in empty}
    result = count_cavities(cavities, ctx.communes, ctx.merged_codes, published)
    _put(properties, "cv", result.counts)
    report = {
        "links": link_source,
        "from_earlier_cache": cached_from,  # department -> day of the cached export used (download failed today)
        "records": len(cavities),
        "departments": sorted(published),
        "not_published": sorted(set(departments) - published),
        "by_method": result.by_method,
        "unattributed": result.unattributed,
        "plm_cities_without_split": result.unknown_plm_cities,
        "communes_with_zero": sum(v == 0 for v in result.counts.values()),
        "quantiles": _quantiles(list(result.counts.values())),
        "top": sorted(result.counts.items(), key=lambda kv: -kv[1])[:10],
    }
    return files, report


def _communes_by_department(communes: list[Area]) -> dict[str, list[Area]]:
    grouped: dict[str, list[Area]] = {}
    for area in communes:
        grouped.setdefault(department_of(area.code), []).append(area)
    return grouped


def _to_l93(geometries: list[BaseGeometry]) -> list[BaseGeometry]:
    def project(coords: np.ndarray) -> np.ndarray:
        x, y = _WGS84_TO_L93.transform(coords[:, 0], coords[:, 1])
        return np.column_stack([x, y])

    return list(shapely.transform(np.asarray(geometries, dtype=object), project))


def _put(properties: dict[str, dict[str, int]], prop: str, values: dict[str, int]) -> None:
    for code, value in values.items():
        properties[code][prop] = int(value)


def _distribution(values: dict[str, int]) -> dict[int, int]:
    return dict(sorted(Counter(values.values()).items()))


def _quantiles(values: list[int]) -> dict[str, float]:
    if not values:
        return {}
    q = np.quantile(values, [0.5, 0.9, 0.99, 1.0])
    return {"p50": float(q[0]), "p90": float(q[1]), "p99": float(q[2]), "max": float(q[3])}


def _int_or_none(value: object) -> int | None:
    try:
        return int(float(str(value).strip()))
    except ValueError:
        return None


def _float_or_none(value: object) -> float | None:
    try:
        return float(str(value).strip())
    except ValueError:
        return None


# --- plausibility gate -----------------------------------------------------------------------------------

# Verified on 2026-11-06 on the national run and, independently, with the Géorisques API (radon, gaspar/risques,
# gaspar/azi, rga at the town centre, cavites) and the public record of the plans named below.
SPOT_CHECKS: dict[str, dict[str, set[int] | range]] = {
    "fl": {
        "37261": {3},  # Tours: PPRI Val de Tours - Val de Luynes (révision), approved
        "45234": {3},  # Orléans: PPRI Val d'Orléans, approved
        "75101": {3}, "75120": {3},  # PPRi de Paris (révision): city-wide record, also for the 20e
        "69381": {3},  # PPRI du Grand Lyon, secteur Lyon-Villeurbanne
        "29013": {0},  # Botmeur, Monts d'Arrée: no flood risk, AZI or PPR listed
        "23096": {0},  # Guéret, on a hill above the Creuse: none listed
    },
    "rn": {
        "23096": {3}, "87085": {3}, "29019": {3}, "2A004": {3},  # Guéret, Limoges, Brest, Ajaccio: granite
        "75101": {1}, "32013": {1},  # Paris basin, Gers molasse
        "01124": {1},  # Cormoz: written "1124" in the ASNR file
    },
    "cl": {
        "32013": {3}, "81004": {2, 3},  # Auch (API: forte at the centre), Albi (moyenne at the centre)
        "29019": {0, 1}, "2A004": {0, 1},  # Brest, Ajaccio: no clay mapped at the centre
    },
    "cv": {
        "45234": range(500, 5_001),  # Orléans: 707 rows in the export (API: 700)
        "76258": range(300, 5_001),  # Terres-de-Caux, marl pits: 302 under its own code, more under former communes
    },
}
CAVITY_FREE_DEPARTMENTS = CAVITIES_NOT_ON_GEORISQUES


def gate(communes: dict[str, dict]) -> list[str]:
    problems: list[str] = []
    for prop, expected in SPOT_CHECKS.items():
        for code, allowed in expected.items():
            if code in communes and communes[code].get(prop) not in allowed:
                problems.append(f"{prop} of {code} is {communes[code].get(prop)}, expected {_describe(allowed)}")
    leaked = [code for code, c in communes.items() if "cv" in c and department_of(str(code)) in CAVITY_FREE_DEPARTMENTS]
    if leaked:
        problems.append(f"cv published for {len(leaked)} communes of departments without a Géorisques inventory, e.g. {leaked[:3]}")
    paris_clay = [code for code, c in communes.items() if "cl" in c and str(code).startswith("751")]
    if paris_clay:
        problems.append(f"cl published for Paris arrondissements {paris_clay[:3]}; the BRGM map excludes the city of Paris")
    return problems


def _describe(allowed: set[int] | range) -> str:
    return f"{allowed.start}..{allowed.stop - 1}" if isinstance(allowed, range) else f"one of {sorted(allowed)}"


LAYER = Layer(
    name=NAME,
    fields={
        "fl": "Flood zoning recorded by the State for the commune (GASPAR): 3 flood risk prevention plan (PPRi/PPRL) "
              "approved, 2 one prescribed, 1 flood hazard mapped in an atlas (AZI) or listed in the departmental "
              "major-risk file (DDRM), 0 none recorded. Commune-wide, not parcel-level; 0 is not proof of safety.",
        "cl": "Clay shrink-swell exposure (BRGM 2026 map) reached by at least a quarter of the commune's area: "
              "0 a priori nil, 1 low, 2 medium, 3 high. Parcel exposure can differ; absent for Paris.",
        "rn": "Radon potential category of the commune (ASNR, arrêté du 27 juin 2018): 1 low, 2 low with factors "
              "easing transfer, 3 significant on at least part of the commune.",
        "cv": "Underground cavities recorded in the BRGM inventory (BDCavités) for the commune; the inventory is "
              "incomplete, 0 means none recorded. Absent where the inventory is not on Géorisques (Île-de-France).",
    },
    compute=compute,
    ranges={"fl": (0, 3), "cl": (0, 3), "rn": (1, 3), "cv": (0, 5_000)},
    min_coverage={"fl": 0.99, "cl": 0.99, "rn": 0.99, "cv": 0.94},
    gate=gate,
)
