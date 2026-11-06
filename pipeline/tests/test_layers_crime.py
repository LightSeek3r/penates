from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import requests
from shapely.geometry import box

from settling import layers
from settling.boundaries import Area
from settling.layers import LayerContext, crime
from settling.layers.crime import BURGLARY, MIN_POPULATION, VIOLENCE, CommuneFigures
from settling.sources import SourceError

INTRA, OUTSIDE, SEXUAL = VIOLENCE
(BURGLARIES,) = BURGLARY
YEARS = (2023, 2024, 2025)


def _row(code: str, year: int, indicator: str, count: int | None, pop: int = 20_000, dwellings: int = 10_000) -> dict:
    return {
        "CODGEO_2026": code,
        "annee": year,
        "indicateur": indicator,
        "unite_de_compte": "Victime",
        "nombre": count,
        "taux_pour_mille": None,
        "est_diffuse": "diff" if count is not None else "ndiff",
        "insee_pop": pop,
        "insee_log": dwellings,
        "complement_info_nombre": None if count is not None else 1.5,
    }


def _commune(code: str, counts: dict[str, int | None], **sizes: int) -> list[dict]:
    """Rows of one commune: the same count for every year of YEARS, None = withheld by the base."""
    return [_row(code, year, indicator, count, **sizes) for year in YEARS for indicator, count in counts.items()]


def _write(path: Path, rows: list[dict]) -> Path:
    pq.write_table(pa.Table.from_pylist(rows), path)
    return path


def _figures(
    rows: int = 3, diffused: int = 3, facts=(10, 20, 30), denominators=(10_000,) * 3, population=MIN_POPULATION
) -> CommuneFigures:
    return CommuneFigures(rows, diffused, list(facts), list(denominators), population)


ALL_KNOWN = {INTRA: 30, OUTSIDE: 60, SEXUAL: 10, BURGLARIES: 50}


def test_violence_sums_the_three_victim_indicators_per_resident_and_burglary_uses_dwellings(tmp_path: Path) -> None:
    rows = _commune("01001", ALL_KNOWN, pop=20_000, dwellings=10_000)
    rows.append(_row("01001", 2022, OUTSIDE, 9_999))  # older than the latest 3 years: ignored
    _, figures = crime.read_figures(_write(tmp_path / "base.parquet", rows))
    properties, absent = crime.publish(figures, ["01001"])
    assert properties == {"01001": {"cr_v": 5.0, "cr_b": 5.0}}  # 100 victims / 20,000; 50 burglaries / 10,000
    assert absent == {"cr_v": {}, "cr_b": {}}


def test_latest_three_years_are_averaged_as_annual_rates(tmp_path: Path) -> None:
    yearly = ((2023, 10, 10_000), (2024, 20, 10_000), (2025, 60, 20_000))
    rows = [_row("01001", year, indicator, count, pop=pop) for year, count, pop in yearly for indicator in VIOLENCE]
    rows += _commune("01001", {BURGLARIES: 5})
    years, figures = crime.read_figures(_write(tmp_path / "base.parquet", rows))
    assert years == YEARS
    # annual rates 3.0, 6.0 and 9.0 per 1,000: mean 6.0 (not 270 victims / 40,000 residents).
    assert crime.publish(figures, ["01001"])[0]["01001"]["cr_v"] == 6.0


def test_a_withheld_component_leaves_the_measure_absent_never_zero(tmp_path: Path) -> None:
    rows = _commune("01001", {INTRA: 30, OUTSIDE: 60, SEXUAL: None, BURGLARIES: 50})
    _, figures = crime.read_figures(_write(tmp_path / "base.parquet", rows))
    properties, absent = crime.publish(figures, ["01001", "01999"])
    assert properties == {"01001": {"cr_b": 5.0}}
    assert absent["cr_v"] == {"not_in_source": 1, "withheld_by_source": 1}
    assert absent["cr_b"] == {"not_in_source": 1}


def test_small_communes_stay_absent_even_with_a_diffused_zero(tmp_path: Path) -> None:
    zeros = dict.fromkeys(ALL_KNOWN, 0)
    rows = _commune("01001", zeros, pop=MIN_POPULATION - 1) + _commune("01002", zeros, pop=MIN_POPULATION)
    _, figures = crime.read_figures(_write(tmp_path / "base.parquet", rows))
    properties, absent = crime.publish(figures, ["01001", "01002"])
    assert properties == {"01002": {"cr_v": 0.0, "cr_b": 0.0}}  # a 3-year zero above the floor is a measurement
    assert absent["cr_v"] == {"below_population_floor": 1}


def test_paris_lyon_marseille_arrondissements_use_their_own_rows(tmp_path: Path) -> None:
    rows = _commune("75101", ALL_KNOWN) + _commune("75056", dict.fromkeys(ALL_KNOWN, 1_000), pop=2_000_000)
    _, figures = crime.read_figures(_write(tmp_path / "base.parquet", rows))
    properties, _ = crime.publish(figures, ["75101"])
    assert properties == {"75101": {"cr_v": 5.0, "cr_b": 5.0}}


@pytest.mark.parametrize(
    ("figures", "expected"),
    [
        (None, (None, "not_in_source")),
        (_figures(rows=2, diffused=2), (None, "incomplete_years")),
        (_figures(diffused=2), (None, "withheld_by_source")),
        (_figures(denominators=(10_000, 0, 10_000)), (None, "no_denominator")),
        (_figures(population=MIN_POPULATION - 1), (None, "below_population_floor")),
        (_figures(facts=(1, 1, 2)), (0.1, "published")),  # 0.133.. rounds to one decimal
    ],
)
def test_rate_rules(figures: CommuneFigures | None, expected: tuple) -> None:
    assert crime.rate(figures, indicators=1) == expected


def test_a_missing_indicator_or_code_column_fails_loudly(tmp_path: Path) -> None:
    with pytest.raises(SourceError, match="lacks indicators"):
        crime.read_figures(_write(tmp_path / "a.parquet", _commune("01001", {INTRA: 1, OUTSIDE: 1, BURGLARIES: 1})))
    rows = _commune("01001", ALL_KNOWN)
    renamed = [{("CODGEO" if k == "CODGEO_2026" else k): v for k, v in row.items()} for row in rows]
    with pytest.raises(SourceError, match="CODGEO_<year>"):
        crime.read_figures(_write(tmp_path / "b.parquet", renamed))


def test_compute_with_a_local_file_records_provenance_without_network(tmp_path: Path) -> None:
    path = _write(tmp_path / "base.parquet", _commune("01001", ALL_KNOWN))
    communes = [Area("01001", "A", "01", box(0, 0, 1, 1)), Area("01002", "B", "01", box(1, 0, 2, 1))]
    ctx = LayerContext(requests.Session(), tmp_path, communes, {}, np.zeros((2, 2)), overrides={"crime": path})
    result = crime.LAYER.compute(ctx)
    assert result.properties == {"01001": {"cr_v": 5.0, "cr_b": 5.0}}
    assert result.source["url"] is None and len(result.source["sha256"]) == 64
    assert result.source["years"] == list(YEARS) and "Licence Ouverte" in result.source["licence"]
    assert result.report["cr_v"]["published"] == 1 and result.report["cr_v"]["absent"] == {"not_in_source": 1}


def _spot_values() -> dict[str, dict]:
    return {code: dict(values) for code, values in crime.SPOT_CHECKS.items()}


def test_gate_accepts_the_verified_values_and_skips_communes_not_built() -> None:
    assert crime.gate(_spot_values()) == []
    assert crime.gate({}) == []


def test_gate_flags_a_wrong_or_missing_value_and_a_published_withheld_commune() -> None:
    communes = _spot_values()
    communes["75101"]["cr_v"] += 1
    del communes["23096"]["cr_b"]
    communes["23001"] = {"cr_v": 0.0}
    problems = crime.gate(communes)
    assert len(problems) == 3
    assert any(p.startswith("75101.cr_v") for p in problems)
    assert any(p.startswith("23096.cr_b is None") for p in problems)
    assert any(p.startswith("23001 must not publish ['cr_v']") for p in problems)


def test_layer_is_discovered_with_consistent_metadata() -> None:
    layer = next(layer for layer in layers.discover() if layer.name == "crime")
    assert set(layer.fields) == set(layer.ranges) == set(layer.min_coverage) == {"cr_v", "cr_b"}
    assert all(0 < share < 0.2 for share in layer.min_coverage.values())
