from datetime import date

import duckdb
from conftest import FIXTURE_CSV

from settling.clean import CleanResult, clean_sales


def _retained_ids(con: duckdb.DuckDBPyConnection) -> list[tuple]:
    return con.execute(
        "SELECT code_commune, kind, round(price_m2) FROM sales ORDER BY code_commune, price_m2"
    ).fetchall()


def test_step_counts_follow_each_rule(cleaned: CleanResult) -> None:
    assert cleaned.steps == {
        "source_rows_in_scope": 37,
        "source_mutations_in_scope": 31,
        "vente_rows": 34,
        "mutations_vente": 28,  # VEFA, Echange, Adjudication out
        "mutations_one_habitation_local": 27,  # two distinct flats in one deed out
        "mutations_no_commercial_local": 26,
        "mutations_single_positive_price": 25,  # valeur_fonciere = 0 out
        "mutations_surface_ge_9": 24,
        "mutations_price_m2_in_bounds": 22,  # 100 and 35000 EUR/m2 out
        "mutations_within_60_months": 22,
    }


def test_window_end_is_newest_transaction(cleaned: CleanResult) -> None:
    assert cleaned.newest_date == date(2025, 12, 31)


def test_commune_alpha_keeps_only_clean_sales(con: duckdb.DuckDBPyConnection, cleaned: CleanResult) -> None:
    alpha = [row for row in _retained_ids(con) if row[0] == "01001"]
    assert alpha == [
        ("01001", "mai", 1000.0),
        ("01001", "mai", 2000.0),
        ("01001", "app", 3000.0),
        ("01001", "app", 4000.0),
        ("01001", "mai", 10000.0),
    ]


def test_repeated_rows_of_one_local_count_once(con: duckdb.DuckDBPyConnection, cleaned: CleanResult) -> None:
    # A1 has four rows (two nature_culture rows for the house, a dependance, a land parcel), one sale.
    n = con.execute("SELECT count(*) FROM sales WHERE round(price_m2) = 1000 AND code_commune = '01001'").fetchone()[0]
    assert n == 1


def test_department_filter_scopes_rows(con: duckdb.DuckDBPyConnection) -> None:
    result = clean_sales(con, FIXTURE_CSV, departments=["75"])
    assert result.steps["source_rows_in_scope"] == 1
    assert _retained_ids(con) == [("75101", "app", 10000.0)]
