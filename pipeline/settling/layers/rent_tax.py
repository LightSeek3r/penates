"""Indicative rent (`rt`, `rtq`) and built-property land-tax rate (`tf`) per tile commune.

Rent: "Carte des loyers" 2025 (Ministère / ANIL, data.gouv.fr), one predicted rent per m2 per month,
charges included, unfurnished, for a reference flat (52 m2) and a reference house (92 m2) let in Q3 2025,
from leboncoin and SeLoger listings 2019-2025, geography at 2025-01-01. The source has no "all housing"
figure, so `rt` is the flat and house predictions weighted by the commune's own listings of each kind
(`nbobs_com`); with no listing of either kind the two are averaged with equal weight. A commune row
with a missing prediction or quality field is non-estimable and skipped (none in the 2025 edition).

`rtq` follows the source's own advice (guide d'utilisation 2025: be careful when R2 < 0.5, fewer than
30 listings in the commune, or a very wide prediction interval; commune-level estimate from 100 listings):
  1 weak   R2_adj < 0.5, or nbobs_com < 30, or 95% interval wider than the estimate (width / rent > 1.0)
  3 solid  nbobs_com >= 100 (estimated at commune level), R2_adj >= 0.5 and width / rent <= 0.7
  2        otherwise
The rating of `rt` is the lowest rating among the estimates carrying at least a quarter of its weight
(all of them if none does).

Tax: DGFiP "Fiscalité locale des particuliers" (data.economie.gouv.fr, from the REI), latest year.
`tf` is DGFiP's Taux_Global_TFB, verified here to be the sum of: commune voted rate (E12VOTE, which since
2021 includes the former department rate), syndicates of communes (E22), intercommunality (E32VOTE),
special equipment taxes (E52, E52A), Île-de-France TASARIF (E52TASA) and GEMAPI (E52GGEMAPI). Not
included: waste collection tax (TEOM), the State's management fees added to the bill, and smoothing
rates of communes nouvelles during convergence (the voted rate is shown). The rate applies to a base
(half the cadastral rental value) that differs for every dwelling: the rate is not the bill.

Joins: rent is published per Paris/Lyon/Marseille arrondissement like the tiles; the tax rate is one
per city and is given to each arrondissement. A tile commune whose former communes (merged after the
sources' geography) are still separate in a source takes their combined rent (listing-weighted) and
their tax rate only if they all share it to one decimal; otherwise the value is absent.
"""

from __future__ import annotations

import csv
import hashlib
import io
import statistics
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import requests

from settling.layers import Layer, LayerContext, LayerResult, Properties
from settling.seismic import plm_parent
from settling.sources import TIMEOUT_S, SourceError, download

NAME = "rent_tax"
OVERRIDE_HINT = f"--layer-file {NAME}=DIR (a directory holding the files below)"

RENT_DATASET_API = "https://www.data.gouv.fr/api/1/datasets/693aa2feed1bf4da603faa49/"
RENT_DATASET_PAGE = "https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025"
# A new edition is a new data.gouv dataset (one per year): moving to it is a deliberate code change.
RENT_EDITION = "Carte des loyers 2025: listings 2019-2025, reference let Q3 2025, communes at 2025-01-01"
RENT_FILES = {"flat": "pred-app-mef-dhup.csv", "house": "pred-mai-mef-dhup.csv"}
RENT_ATTRIBUTION = "Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin"

TAX_DATASET_API = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers"
TAX_FILE = "fiscalite-locale-tfb.csv"
TAX_PARTS = ("e12vote", "e22", "e32vote", "e52", "e52a", "e52tasa", "e52ggemapi")
TAX_TOTAL = "taux_global_tfb"
TAX_COLUMNS = ("exercice", "insee_com", *TAX_PARTS, TAX_TOTAL)
TAX_SUM_TOLERANCE = 0.02  # the source rounds the parts and the total separately

LICENCE = "Licence Ouverte v2.0 (Etalab)"

MIN_R2 = 0.5
WEAK_LISTINGS = 30
COMMUNE_LEVEL_LISTINGS = 100
WEAK_WIDTH = 1.0
SOLID_WIDTH = 0.7
RATED_WEIGHT_SHARE = 0.25
WEAK, FAIR, SOLID = 1, 2, 3
MISSING_TEXT = frozenset({"", "NA", "NAN", "NULL"})


@dataclass(frozen=True)
class RentEstimate:
    rent: float  # EUR per m2 per month, charges included
    low: float  # 95% prediction interval
    high: float
    listings: int  # listings of this kind in the commune itself
    r2: float  # adjusted R2 of the hedonic model used


def rent_reliability(estimate: RentEstimate) -> int:
    width = (estimate.high - estimate.low) / estimate.rent
    if estimate.r2 < MIN_R2 or estimate.listings < WEAK_LISTINGS or width > WEAK_WIDTH:
        return WEAK
    if estimate.listings >= COMMUNE_LEVEL_LISTINGS and width <= SOLID_WIDTH:
        return SOLID
    return FAIR


def combine_rents(estimates: list[RentEstimate]) -> tuple[float, int]:
    """Listing-weighted rent (equal weights without listings) and its rating."""
    listings = sum(e.listings for e in estimates)
    weights = [e.listings / listings if listings else 1 / len(estimates) for e in estimates]
    rent = sum(w * e.rent for w, e in zip(weights, estimates))
    rated = [e for w, e in zip(weights, estimates) if w >= RATED_WEIGHT_SHARE] or estimates
    return rent, min(rent_reliability(e) for e in rated)


def parse_number(text: str | None) -> float | None:
    cleaned = (text or "").strip().replace(",", ".")
    if cleaned.upper() in MISSING_TEXT:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def read_rent_csv(path: Path) -> dict[str, RentEstimate]:
    """INSEE code -> estimate; rows with a missing figure (non-estimable) are left out."""
    estimates: dict[str, RentEstimate] = {}
    for row in csv.DictReader(io.StringIO(_decode(path.read_bytes())), delimiter=";"):
        values = [parse_number(row.get(c)) for c in ("loypredm2", "lwr.IPm2", "upr.IPm2", "nbobs_com", "R2_adj")]
        code = (row.get("INSEE_C") or "").strip()
        if code and all(v is not None for v in values) and values[0] > 0:
            rent, low, high, listings, r2 = values
            estimates[code] = RentEstimate(rent, low, high, int(listings), r2)
    return estimates


def read_tax_csv(path: Path) -> tuple[str, dict[str, float], list[str]]:
    """(year, INSEE code -> global TFB rate %, codes whose parts do not add up to the total)."""
    years: set[str] = set()
    rates: dict[str, float] = {}
    mismatched: list[str] = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            code, total = row["insee_com"].strip(), parse_number(row[TAX_TOTAL])
            if not code or total is None:
                continue
            years.add(row["exercice"].strip())
            rates[code] = total
            if abs(sum(parse_number(row[p]) or 0.0 for p in TAX_PARTS) - total) > TAX_SUM_TOLERANCE:
                mismatched.append(code)
    if len(years) != 1:
        raise SourceError(f"{path}: expected one tax year, found {sorted(years)}")
    return years.pop(), rates, mismatched


def former_communes(merged_codes: dict[str, str]) -> dict[str, list[str]]:
    former: dict[str, list[str]] = {}
    for old, new in merged_codes.items():
        former.setdefault(new, []).append(old)
    return {new: sorted(olds) for new, olds in former.items()}


def assign_rents(
    codes: list[str], kinds: list[dict[str, RentEstimate]], merged_codes: dict[str, str]
) -> tuple[dict[str, tuple[float, int]], Counter[str], list[str]]:
    former = former_communes(merged_codes)
    rents: dict[str, tuple[float, int]] = {}
    methods: Counter[str] = Counter()
    missing: list[str] = []
    for code in codes:
        found = [c for c in (code, *former.get(code, [])) if any(c in kind for kind in kinds)]
        if not found:
            missing.append(code)
            continue
        rents[code] = combine_rents([kind[c] for c in found for kind in kinds if c in kind])
        methods["own_code" if found == [code] else "former_communes"] += 1
    return rents, methods, missing


def assign_tax_rates(
    codes: list[str], rates: dict[str, float], merged_codes: dict[str, str]
) -> tuple[dict[str, float], Counter[str], list[str], list[dict]]:
    former = former_communes(merged_codes)
    assigned: dict[str, float] = {}
    methods: Counter[str] = Counter()
    missing: list[str] = []
    disagreeing: list[dict] = []
    for code in codes:
        found = {c: rates[c] for c in (code, *former.get(code, [])) if c in rates}
        parent = plm_parent(code)
        if not found and parent in rates:
            assigned[code], method = rates[parent], "plm_parent"
        elif found and len({round(v, 1) for v in found.values()}) == 1:
            assigned[code] = next(iter(found.values()))
            method = "own_code" if list(found) == [code] else "former_communes"
        elif found:
            disagreeing.append({"code": code, "rates": found})  # rates still converging: no single rate
            continue
        else:
            missing.append(code)
            continue
        methods[method] += 1
    return assigned, methods, missing, disagreeing


def build_properties(rents: dict[str, tuple[float, int]], rates: dict[str, float]) -> Properties:
    properties: Properties = {}
    for code, (rent, rating) in rents.items():
        properties.setdefault(code, {}).update(rt=round(rent, 1), rtq=rating)
    for code, rate in rates.items():
        properties.setdefault(code, {})["tf"] = round(rate, 1)
    return properties


def quantiles(values: list[float]) -> dict[str, float]:
    if len(values) < 2:
        return {}
    cuts = statistics.quantiles(values, n=20, method="inclusive")
    return {"min": min(values), "p5": round(cuts[0], 1), "p25": round(cuts[4], 1), "p50": round(cuts[9], 1),
            "p75": round(cuts[14], 1), "p95": round(cuts[18], 1), "max": max(values)}


def compute(ctx: LayerContext) -> LayerResult:
    override = ctx.overrides.get(NAME)
    rent_paths, rent_source = _rent_files(ctx.session, ctx.raw, override)
    tax_path, tax_source = _tax_file(ctx.session, ctx.raw, override)
    kinds = [read_rent_csv(rent_paths[kind]) for kind in RENT_FILES]
    year, tax_rates, tax_mismatched = read_tax_csv(tax_path)
    codes = ctx.codes
    rents, rent_methods, rent_missing = assign_rents(codes, kinds, ctx.merged_codes)
    rates, tax_methods, tax_missing, tax_disagreeing = assign_tax_rates(codes, tax_rates, ctx.merged_codes)
    properties = build_properties(rents, rates)
    total = len(codes) or 1
    report = {
        "communes": len(codes),
        "rt": {"present": len(rents), "coverage": round(len(rents) / total, 4), "by_method": dict(rent_methods),
               "quantiles": quantiles([p["rt"] for p in properties.values() if "rt" in p]),
               "rtq": dict(sorted(Counter(rating for _, rating in rents.values()).items())),
               "missing": rent_missing[:50]},
        "tf": {"year": year, "present": len(rates), "coverage": round(len(rates) / total, 4),
               "by_method": dict(tax_methods),
               "quantiles": quantiles([p["tf"] for p in properties.values() if "tf" in p]),
               "former_communes_disagree": tax_disagreeing[:50], "missing": tax_missing[:50],
               "source_rows_parts_not_summing": tax_mismatched[:50]},
    }
    tax_source["year"] = year
    return LayerResult(properties, {"rent": rent_source, "tax": tax_source}, report)


def _rent_files(session: requests.Session, raw: Path, override: Path | None) -> tuple[dict[str, Path], dict]:
    source = {"dataset": RENT_DATASET_PAGE, "edition": RENT_EDITION, "licence": LICENCE,
              "attribution": RENT_ATTRIBUTION, "files": {}}
    if override is not None:
        paths = {kind: override / name for kind, name in RENT_FILES.items()}
    else:
        response = session.get(RENT_DATASET_API, timeout=TIMEOUT_S)
        response.raise_for_status()
        resources = {r["url"].rsplit("/", 1)[-1]: r for r in response.json()["resources"]}
        paths = {}
        for kind, name in RENT_FILES.items():
            resource = resources.get(name)
            if resource is None:
                raise SourceError(f"{RENT_DATASET_API}: no resource named {name}")
            tag = resource["last_modified"][:10]
            paths[kind] = raw / NAME / f"{tag}-{name}"
            download(session, resource["url"], paths[kind], resource.get("filesize"), override_flag=OVERRIDE_HINT)
            source["files"][kind] = {"url": resource["url"], "last_modified": resource["last_modified"]}
    for kind, path in paths.items():
        source["files"].setdefault(kind, {"file": path.name})["sha256"] = _sha256(path)
    return paths, source


def _tax_file(session: requests.Session, raw: Path, override: Path | None) -> tuple[Path, dict]:
    source = {"dataset": TAX_DATASET_API.replace("/api/explore/v2.1/catalog/datasets/", "/explore/dataset/"),
              "licence": LICENCE, "attribution": "DGFiP, fichier de recensement des éléments d'imposition (REI)",
              "field": TAX_TOTAL, "sums": list(TAX_PARTS)}
    if override is not None:
        path = override / TAX_FILE
    else:
        response = session.get(TAX_DATASET_API, timeout=TIMEOUT_S)
        response.raise_for_status()
        processed = response.json()["metas"]["default"]["data_processed"]
        year = _latest_tax_year(session)
        path = raw / NAME / f"tfb-{year}-{processed[:10]}.csv"
        url = f"{TAX_DATASET_API}/exports/csv"
        params = {"where": f"exercice='{year}'", "select": ",".join(TAX_COLUMNS), "delimiter": ";"}
        download(session, requests.Request("GET", url, params=params).prepare().url, path, None,
                 override_flag=OVERRIDE_HINT)
        source |= {"url": url, "params": params, "data_processed": processed}
    source["sha256"] = _sha256(path)
    return path, source


def _latest_tax_year(session: requests.Session) -> str:
    params = {"select": "exercice", "group_by": "exercice", "order_by": "exercice desc", "limit": 1}
    response = session.get(f"{TAX_DATASET_API}/records", params=params, timeout=TIMEOUT_S)
    response.raise_for_status()
    results = response.json().get("results") or []
    if not results:
        raise SourceError(f"{TAX_DATASET_API}: no tax year found")
    return results[0]["exercice"]


def _decode(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252")  # the 2025 rent files are Windows-1252


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# Verified in the sources on 2026-11-06 (tax year 2025; rent edition 2025).
TAX_SPOT_CHECKS = {"75101": 21.2, "69381": 32.8, "69264": 32.5, "23096": 51.0}
SPOT_CHECK_TOLERANCE = 0.051  # tile values may come back as float32
PARIS_RENT_MEDIAN = (28.0, 36.0)  # arrondissements: 27.7..37.9, median 32.2
CREUSE_RENT_MEDIAN = (5.5, 8.0)  # department 23: median 7.0
RENT_MEDIAN_MIN_COMMUNES = 15


def gate(communes: dict[str, dict]) -> list[str]:
    problems = []
    for code, expected in TAX_SPOT_CHECKS.items():
        if code in communes and abs(communes[code].get("tf", -1.0) - expected) > SPOT_CHECK_TOLERANCE:
            problems.append(f"{code}: tf {communes[code].get('tf')} != {expected}")
    for label, prefix, (low, high) in (("Paris", "751", PARIS_RENT_MEDIAN), ("Creuse", "23", CREUSE_RENT_MEDIAN)):
        rents = [p["rt"] for c, p in communes.items() if c.startswith(prefix) and "rt" in p]
        if len(rents) >= RENT_MEDIAN_MIN_COMMUNES and not low <= statistics.median(rents) <= high:
            problems.append(f"{label}: median rt {statistics.median(rents)} outside {low}..{high}")
    unpaired = [c for c, p in communes.items() if ("rt" in p) != ("rtq" in p)]
    if unpaired:
        problems.append(f"rt and rtq not paired for {len(unpaired)} communes, e.g. {unpaired[:3]}")
    return problems


LAYER = Layer(
    name=NAME,
    fields={
        "rt": "Indicative rent EUR/m2/month, charges included, unfurnished, flats and houses weighted by the "
              "commune's listings (Carte des loyers 2025, ANIL)",
        "rtq": "Reliability of rt: 1 weak, 2 fair, 3 solid (R2, listings in the commune, prediction interval)",
        "tf": "Global built-property land-tax rate % (taxe foncière bâtie: commune incl. former department part, "
              "intercommunality, syndicates, TSE, GEMAPI; DGFiP REI, latest year); not the bill",
    },
    compute=compute,
    # Rent 2025: 5.7..37.9. Tax 2025: 4.6..101.1 (several Aude communes are above 90).
    ranges={"rt": (3.0, 45.0), "rtq": (1, 3), "tf": (3.0, 110.0)},
    min_coverage={"rt": 0.98, "rtq": 0.98, "tf": 0.98},
    gate=gate,
)
