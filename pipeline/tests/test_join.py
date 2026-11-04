import duckdb
import pytest

from settling.boundaries import Boundaries
from settling.clean import CleanResult
from settling.join import CodeMapping, UnmatchedCodesError, check_unmatched, reconcile_codes


def test_plm_parent_commune_is_replaced_by_arrondissements(boundaries: Boundaries) -> None:
    codes = {a.code for a in boundaries.communes}
    assert "75101" in codes
    assert "75056" not in codes


def test_arrondissement_code_joins_directly(
    con: duckdb.DuckDBPyConnection, cleaned: CleanResult, boundaries: Boundaries
) -> None:
    report = reconcile_codes(con, boundaries)
    assert "75101" not in {m.old for m in report.mappings}
    assert "75101" not in report.unmatched_after
    assert con.execute("SELECT count(*) FROM sales WHERE code_commune = '75101'").fetchone()[0] == 1


def test_old_codes_are_mapped_by_merger_table_then_location(
    con: duckdb.DuckDBPyConnection, cleaned: CleanResult, boundaries: Boundaries
) -> None:
    report = reconcile_codes(con, boundaries)
    assert sorted(report.mappings, key=lambda m: m.old) == [
        CodeMapping("01098", "01003", 1, "sale_location"),
        CodeMapping("01099", "01003", 1, "commune_deleguee"),
    ]
    assert report.unmatched_codes_before == 3
    assert report.unmatched_after == {"01097": 1}  # no coordinates, no merger entry
    assert report.boundary_communes_without_sales == 1  # 01004


def test_build_fails_above_unmatched_threshold(
    con: duckdb.DuckDBPyConnection, cleaned: CleanResult, boundaries: Boundaries
) -> None:
    report = reconcile_codes(con, boundaries)
    assert report.unmatched_share_after == pytest.approx(1 / 22)
    with pytest.raises(UnmatchedCodesError):
        check_unmatched(report)
