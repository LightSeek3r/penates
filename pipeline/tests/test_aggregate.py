from datetime import date

import duckdb
import pytest

from settling import aggregate as agg
from settling.boundaries import Boundaries
from settling.clean import CleanResult
from settling.join import reconcile_codes


@pytest.fixture
def commune_stats(con: duckdb.DuckDBPyConnection, cleaned: CleanResult, boundaries: Boundaries) -> dict:
    reconcile_codes(con, boundaries)
    window_by_months = agg.windows(con, cleaned.newest_date)
    stats = agg.compute_stats(con, "code_commune", window_by_months[36].start)
    yearly = agg.yearly_medians(con, "code_commune")
    return {
        a.code: agg.area_stats(a.code, agg.is_no_coverage(a.code, a.dep), stats, yearly, window_by_months)
        for a in boundaries.communes
    }


def test_windows_end_at_newest_transaction(con: duckdb.DuckDBPyConnection, cleaned: CleanResult) -> None:
    window_by_months = agg.windows(con, cleaned.newest_date)
    assert window_by_months[36] == agg.Window(36, date(2023, 1, 1), date(2025, 12, 31))
    assert window_by_months[60] == agg.Window(60, date(2021, 1, 1), date(2025, 12, 31))


def test_median_and_quartiles_interpolate(commune_stats: dict) -> None:
    alpha = commune_stats["01001"]
    assert alpha.by_kind["all"] == agg.Stat(n=5, p25=2000, median=3000, p75=4000)
    assert alpha.by_kind["mai"].median == 2000
    assert alpha.by_kind["app"].median == 3500  # even n: mean of the two middle values


def test_sparse_commune_falls_back_to_60_months(commune_stats: dict) -> None:
    beta = commune_stats["01002"]
    props = agg.tile_properties(beta, with_trend=True)
    assert props["w"] == 60
    assert props["n_all"] == 12
    assert props["c_all"] == 2
    assert props["p_all"] == 1500
    assert props["period"] == "2021-01/2025-12"


def test_commune_with_enough_recent_sales_keeps_36_months(commune_stats: dict) -> None:
    props = agg.tile_properties(commune_stats["01001"], with_trend=True)
    assert props["w"] == 36
    assert props["c_all"] == 1


def test_yearly_trend_needs_five_sales(commune_stats: dict) -> None:
    props = agg.tile_properties(commune_stats["01002"], with_trend=True)
    assert props["t2021"] == 1200
    assert "t2022" not in props  # 4 sales only


def test_no_coverage_department_has_no_price(commune_stats: dict) -> None:
    props = agg.tile_properties(commune_stats["57001"], with_trend=True)
    assert props == {"c_all": 4, "c_mai": 4, "c_app": 4}


def test_area_without_sales_is_insufficient(commune_stats: dict) -> None:
    props = agg.tile_properties(commune_stats["01004"], with_trend=True)
    assert props["c_all"] == 0
    assert props["n_all"] == 0
    assert "p_all" not in props


def test_properties_are_integers_or_period(commune_stats: dict) -> None:
    for stats in commune_stats.values():
        for key, value in agg.tile_properties(stats, with_trend=True).items():
            assert isinstance(value, str) if key == "period" else isinstance(value, int), key


@pytest.mark.parametrize(("n", "expected"), [(0, 0), (1, 1), (9, 1), (10, 2), (29, 2), (30, 3), (5000, 3)])
def test_confidence_thresholds(n: int, expected: int) -> None:
    assert agg.confidence(n) == expected


@pytest.mark.parametrize(
    ("code", "dep", "expected"),
    [("57463", "57", True), ("67482", "67", True), ("68224", "68", True), ("97611", "976", True), ("69123", "69", False)],
)
def test_no_coverage_areas(code: str, dep: str, expected: bool) -> None:
    assert agg.is_no_coverage(code, dep) is expected
