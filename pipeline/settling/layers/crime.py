"""Recorded crime per commune (OPT-IN layer, never in the default view), from the SSMSI communal base.

Source: SSMSI (Ministère de l'Intérieur), "Base statistique communale de la délinquance enregistrée par la
police et la gendarmerie nationales", Parquet edition July 2026 (years 2016-2025, geography 2026-01-01),
Licence Ouverte 2.0. These are offences RECORDED by police and gendarmerie by place of commission: they
reflect victims' propensity to report and police activity as much as actual crime.

Tile properties, each a mean of the annual rates over the latest 3 years of the base, one decimal:
  cr_v  victims of recorded physical or sexual violence per 1,000 residents per year: the sum of the base's
        three victim-counted violence indicators "Violences physiques intrafamiliales", "Violences physiques
        hors cadre familial" and "Violences sexuelles" (the SSMSI publishes the two physical ones as summable;
        all three share the unit "Victime"). Robberies ("Vols avec armes", "Vols violents sans arme") are left
        out: they are counted in "Infraction", and the SSMSI warns against adding indicators of different units.
  cr_b  recorded home burglaries ("Cambriolages de logement") per 1,000 dwellings per year, the base's own
        denominator (INSEE census dwellings, all dwellings including second homes and vacant ones).

A value is published only when, for every component and each of the 3 years, the base marks the figure as
diffused (`est_diffuse == "diff"`). The base withholds ("ndiff") communes that did not record more than 5
facts in 3 successive years (statistical secrecy and fragility); those stay ABSENT, never 0. A diffused 0
is a measurement (the base publishes a zero repeated over 3 years).

On top of that, a value is published only for communes of at least `MIN_POPULATION` residents (municipal
population of the latest year in the base): per-resident rates of smaller communes swing on one or two
facts, and their visible values would be biased towards zero (the base publishes a 3-year zero but withholds
1 to 5 facts a year). Rates per resident also overstate places whose daytime population far exceeds the
residents (city centres, retail zones, stations, resorts).

Paris, Lyon and Marseille: the base codes the 45 municipal arrondissements under their own codes, exactly
like the tiles; the parent communes' rows are not used.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import pyarrow.parquet as pq

from settling.layers import Layer, LayerContext, LayerResult, Properties
from settling.sources import SourceError, download

DATASET_PAGE = (
    "https://www.data.gouv.fr/datasets/bases-statistiques-communale-departementale-et-regionale-de-la-delinquance-"
    "enregistree-par-la-police-et-la-gendarmerie-nationales"
)
# Pinned edition, verified 2026-11-06 (data.gouv.fr resource 604d71b8-337d-4869-9226-49e01bae87df). A new
# SSMSI edition gets a new URL: moving to it is a deliberate change that must re-verify SPOT_CHECKS.
EDITION = "2016-2025, geography 2026-01-01, produced 2026-06-25, published 2026-07-09"
PARQUET_URL = (
    "https://static.data.gouv.fr/resources/bases-statistiques-communale-departementale-et-regionale-de-la-"
    "delinquance-enregistree-par-la-police-et-la-gendarmerie-nationales/20260709-120017/"
    "donnee-comm-data.gouv-parquet-2025-geographie2026-produit-le2026-06-25.parquet"
)
PARQUET_SHA1 = "a68550f3b9dcc8a42d8ebd78025f84a29970fd0f"
PARQUET_BYTES = 16_095_547
LICENCE = "Licence Ouverte / Open Licence 2.0 (Etalab)"

YEARS = 3
MIN_POPULATION = 1_000
VIOLENCE = ("Violences physiques intrafamiliales", "Violences physiques hors cadre familial", "Violences sexuelles")
BURGLARY = ("Cambriolages de logement",)
DIFFUSED = "diff"
CODE_COLUMN = re.compile(r"CODGEO_\d{4}")
COLUMNS = ("annee", "indicateur", "est_diffuse", "nombre", "insee_pop", "insee_log")


@dataclass(frozen=True)
class Measure:
    prop: str
    indicators: tuple[str, ...]
    denominator: str  # base column: residents (insee_pop) or dwellings (insee_log)


MEASURES = (Measure("cr_v", VIOLENCE, "insee_pop"), Measure("cr_b", BURGLARY, "insee_log"))

# Expected tile values, computed from the raw rows of the pinned Parquet (2023-2025 counts / denominators),
# independently of this module.
SPOT_CHECKS: dict[str, dict[str, float]] = {
    "75101": {"cr_v": 44.9, "cr_b": 8.6},  # Paris 1er: 15,114 residents, a far larger daytime population
    "75116": {"cr_v": 7.3, "cr_b": 7.6},  # Paris 16e
    "69381": {"cr_v": 14.2, "cr_b": 8.2},  # Lyon 1er
    "13201": {"cr_v": 25.9, "cr_b": 15.9},  # Marseille 1er
    "69264": {"cr_v": 12.9, "cr_b": 6.5},  # Villefranche-sur-Saône
    "23096": {"cr_v": 15.6, "cr_b": 5.3},  # Guéret
    "22014": {"cr_b": 0.0},  # 1,277 residents, no burglary recorded in 3 years: a published zero
}
# Withheld by the base, or diffused but under MIN_POPULATION: these must stay absent.
MUST_BE_ABSENT: dict[str, tuple[str, ...]] = {
    "22014": ("cr_v",),  # violence withheld by the base
    "23001": ("cr_v", "cr_b"),  # Ahun, 1,394 residents: both withheld by the base
    "23011": ("cr_b",),  # 163 residents: a diffused 3-year zero, under the population floor
    "23034": ("cr_v", "cr_b"),  # 32 residents: diffused 3-year zeros, under the population floor
}
SPOT_TOLERANCE = 0.05


@dataclass(frozen=True)
class CommuneFigures:
    """One commune and one measure over the latest years: what the base says before any rule is applied."""

    rows: int  # (indicator, year) rows found
    diffused: int  # of which marked diffused
    facts_per_year: list[int]
    denominators: list[int]
    population: int  # residents, latest year


def compute(ctx: LayerContext) -> LayerResult:
    path, source = _fetch(ctx)
    years, figures = read_figures(path)
    properties, absent = publish(figures, ctx.codes)
    source |= {"years": list(years), "sha256": _sha256(path)}
    return LayerResult(properties, source, _report(properties, absent, years, ctx.codes))


def read_figures(path: Path) -> tuple[tuple[int, ...], dict[str, dict[str, CommuneFigures]]]:
    """Per commune and measure, the rows of the latest `YEARS` years of the base (the base's own codes)."""
    code_column = _code_column(path)
    con = duckdb.connect()
    try:
        con.read_parquet(str(path)).project(f"{code_column} AS code, {', '.join(COLUMNS)}").create_view("base")
        newest = con.execute("SELECT max(annee) FROM base").fetchone()[0]
        years = tuple(range(newest - YEARS + 1, newest + 1))
        found = {row[0] for row in con.execute("SELECT DISTINCT indicateur FROM base").fetchall()}
        missing = {i for m in MEASURES for i in m.indicators} - found
        if missing:
            raise SourceError(f"{path}: SSMSI base lacks indicators {sorted(missing)}")
        figures: dict[str, dict[str, CommuneFigures]] = {}
        for measure in MEASURES:
            for code, *values in _measure_rows(con, measure, years):
                figures.setdefault(code, {})[measure.prop] = CommuneFigures(*values)
    finally:
        con.close()
    return years, figures


def publish(
    figures: dict[str, dict[str, CommuneFigures]], codes: list[str]
) -> tuple[Properties, dict[str, dict[str, int]]]:
    """Tile properties for `codes`, and per property the number of absent communes by reason."""
    properties: Properties = {}
    absent: dict[str, dict[str, int]] = {m.prop: {} for m in MEASURES}
    for code in codes:
        for measure in MEASURES:
            value, reason = rate(figures.get(code, {}).get(measure.prop), len(measure.indicators))
            if value is None:
                absent[measure.prop][reason] = absent[measure.prop].get(reason, 0) + 1
            else:
                properties.setdefault(code, {})[measure.prop] = value
    return properties, absent


def rate(figures: CommuneFigures | None, indicators: int) -> tuple[float | None, str]:
    """Mean annual rate per 1,000 (one decimal), or None and the reason it is withheld."""
    if figures is None:
        return None, "not_in_source"
    if figures.rows != indicators * YEARS:
        return None, "incomplete_years"
    if figures.diffused != figures.rows:
        return None, "withheld_by_source"
    if min(figures.denominators) <= 0:
        return None, "no_denominator"
    if figures.population < MIN_POPULATION:
        return None, "below_population_floor"
    annual = [1_000 * facts / base for facts, base in zip(figures.facts_per_year, figures.denominators)]
    return round(sum(annual) / len(annual), 1), "published"


def gate(communes: dict[str, dict]) -> list[str]:
    """Spot checks against values computed by hand from the pinned base; skipped for communes not built."""
    problems = []
    for code, expected in SPOT_CHECKS.items():
        if code not in communes:
            continue
        for prop, value in expected.items():
            got = communes[code].get(prop)
            if got is None or abs(got - value) > SPOT_TOLERANCE:
                problems.append(f"{code}.{prop} is {got}, expected {value} from the SSMSI base")
    for code, props in MUST_BE_ABSENT.items():
        present = [prop for prop in props if prop in communes.get(code, {})]
        if present:
            problems.append(f"{code} must not publish {present} (withheld by the source or under the population floor)")
    return problems


def _measure_rows(con: duckdb.DuckDBPyConnection, measure: Measure, years: tuple[int, ...]) -> list[tuple]:
    indicators = list(measure.indicators)
    return con.execute(
        f"""
        WITH yearly AS (
            SELECT code, annee,
                   count(*) AS rows,
                   count(*) FILTER (WHERE est_diffuse = '{DIFFUSED}') AS diffused,
                   sum(nombre) AS facts,
                   min({measure.denominator}) AS denominator,
                   min(insee_pop) AS population
            FROM base
            WHERE annee BETWEEN ? AND ? AND list_contains(?, indicateur)
            GROUP BY code, annee
        )
        SELECT code,
               sum(rows)::INTEGER,
               sum(diffused)::INTEGER,
               list(coalesce(facts, 0)::INTEGER ORDER BY annee),
               list(coalesce(denominator, 0)::INTEGER ORDER BY annee),
               coalesce(arg_max(population, annee), 0)::INTEGER
        FROM yearly
        GROUP BY code
        """,
        [years[0], years[-1], indicators],
    ).fetchall()


def _code_column(path: Path) -> str:
    # The code column is named after the base's COG year (CODGEO_2026 in the July 2026 edition).
    names = [name for name in pq.read_schema(path).names if CODE_COLUMN.fullmatch(name)]
    if len(names) != 1:
        raise SourceError(f"{path}: expected one CODGEO_<year> column, found {names}")
    return names[0]


def _fetch(ctx: LayerContext) -> tuple[Path, dict]:
    source = {
        "dataset": DATASET_PAGE, "edition": EDITION, "licence": LICENCE, "producer": "SSMSI, Ministère de l'Intérieur"
    }
    override = ctx.overrides.get("crime")
    if override is not None:
        return override, source | {"url": None, "file": override.name}
    dest = ctx.raw / "crime" / PARQUET_URL.rsplit("/", 1)[-1]
    download(ctx.session, PARQUET_URL, dest, PARQUET_BYTES, PARQUET_SHA1, override_flag="--layer-file crime=PATH")
    return dest, source | {"url": PARQUET_URL, "sha1": PARQUET_SHA1, "file": dest.name}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _report(
    properties: Properties, absent: dict[str, dict[str, int]], years: tuple[int, ...], codes: list[str]
) -> dict:
    report: dict = {"years": list(years), "communes": len(codes), "min_population": MIN_POPULATION}
    for measure in MEASURES:
        values = np.array([p[measure.prop] for p in properties.values() if measure.prop in p], dtype=float)
        report[measure.prop] = {
            "published": int(values.size),
            "zero": int((values == 0).sum()),
            "absent": dict(sorted(absent[measure.prop].items())),
            "quantiles": {
                f"p{q}": round(float(np.percentile(values, q)), 1) for q in (5, 25, 50, 75, 95, 99)
            } | {"max": float(values.max())}
            if values.size
            else {},
        }
    return report


LAYER = Layer(
    name="crime",
    fields={
        "cr_v": "Number: victims of recorded physical or sexual violence per 1,000 residents per year, "
        "3-year mean (SSMSI; recorded offences, opt-in)",
        "cr_b": "Number: recorded home burglaries per 1,000 dwellings per year, 3-year mean "
        "(SSMSI; recorded offences, opt-in)",
    },
    compute=compute,
    ranges={"cr_v": (0, 200), "cr_b": (0, 150)},
    min_coverage={"cr_v": 0.04, "cr_b": 0.08},
    gate=gate,
)
