"""DVF cleaning in DuckDB: raw geo-DVF rows -> one row per retained residential sale.

The `sales` table lives only in the in-memory DuckDB connection. It is never written to disk,
logged or exported: DVF terms forbid re-identification, so only aggregates leave this process.

Retained-sale rule, evaluated per id_mutation (a DVF "mutation" = one deed; its valeur_fonciere is
repeated on every row of the deed, so rows are grouped before any price is read):
  1. nature_mutation = 'Vente' (drops VEFA, Echange, Adjudication, Expropriation, terrain a batir).
  2. exactly one distinct habitation local (type_local Maison or Appartement). geo-DVF repeats a
     local once per nature_culture of its parcel (e.g. "sols" + "jardins"), so a local is identified
     by (id_parcelle, type_local, surface_reelle_bati, nombre_pieces_principales, lot1_numero)
     instead of by row. Deeds with two or more distinct habitation locals are dropped.
  3. no 'Local industriel. commercial ou assimile' row: its value is inside the price.
  4. Dependance rows (cellars, parkings) and bare land rows are ignored, not disqualifying: they
     come with most flats and houses, and the deed price cannot be split.
  5. a single distinct valeur_fonciere > 0, surface_reelle_bati >= 9 m2.
  6. price_m2 = valeur_fonciere / surface_reelle_bati within PRICE_BOUNDS.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path

import duckdb

HABITATION_TYPES = ("Maison", "Appartement")
COMMERCIAL_TYPE_PREFIX = "Local industriel"
MIN_SURFACE_M2 = 9
# deliberate: coarse absolute guard against keying errors and non-market deeds; revisit with
# per-commune robust trimming (e.g. MAD) if outliers survive into the medians.
PRICE_BOUNDS = (200, 30000)
FALLBACK_WINDOW_MONTHS = 60
MAYOTTE_DEP = "976"
OVERSEAS_PREFIX = "97"

SOURCE_COLUMNS = """
    CAST(id_mutation AS VARCHAR) AS id_mutation,
    TRY_CAST(date_mutation AS DATE) AS date_mutation,
    CAST(nature_mutation AS VARCHAR) AS nature_mutation,
    TRY_CAST(valeur_fonciere AS DOUBLE) AS valeur_fonciere,
    CAST(code_commune AS VARCHAR) AS code_commune,
    CAST(code_departement AS VARCHAR) AS code_departement,
    CAST(id_parcelle AS VARCHAR) AS id_parcelle,
    CAST(type_local AS VARCHAR) AS type_local,
    TRY_CAST(surface_reelle_bati AS DOUBLE) AS surface_reelle_bati,
    TRY_CAST(nombre_pieces_principales AS INTEGER) AS nombre_pieces_principales,
    CAST(lot1_numero AS VARCHAR) AS lot1_numero,
    TRY_CAST(longitude AS DOUBLE) AS longitude,
    TRY_CAST(latitude AS DOUBLE) AS latitude
"""


@dataclass(frozen=True)
class CleanResult:
    newest_date: date
    oldest_date: date
    steps: dict[str, int]
    overseas_rows_excluded: int


def source_relation(path: Path) -> str:
    """DuckDB table function reading a geo-DVF file (official csv/csv.gz, or a Parquet copy)."""
    posix = path.as_posix().replace("'", "''")
    if path.suffix == ".parquet":
        return f"read_parquet('{posix}')"
    # all_varchar keeps INSEE codes such as 01001 / 2A004 as text; casts happen in SOURCE_COLUMNS.
    return f"read_csv('{posix}', header = true, all_varchar = true)"


def clean_sales(con: duckdb.DuckDBPyConnection, source: Path, departments: list[str] | None) -> CleanResult:
    """Create table `sales(code_commune, code_departement, kind, date_mutation, price_m2)`."""
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE src AS
        SELECT {SOURCE_COLUMNS} FROM {source_relation(source)}
        WHERE code_departement IS NOT NULL AND code_departement <> '{MAYOTTE_DEP}'
        """
    )
    overseas = _scalar(con, f"SELECT count(*) FROM src WHERE code_departement LIKE '{OVERSEAS_PREFIX}%'")
    scope = _scope_predicate(departments)
    con.execute(f"DELETE FROM src WHERE NOT ({scope})")
    _create_mutations(con)
    con.execute("DROP TABLE src")
    newest, oldest = con.execute("SELECT max(date_mutation), min(date_mutation) FROM mutations").fetchone()
    if newest is None:
        raise ValueError("no DVF rows in scope")
    steps = _apply_rules(con, newest)
    return CleanResult(newest_date=newest, oldest_date=oldest, steps=steps, overseas_rows_excluded=overseas)


def _scope_predicate(departments: list[str] | None) -> str:
    if departments is None:
        return f"code_departement NOT LIKE '{OVERSEAS_PREFIX}%'"
    quoted = ", ".join("'" + d.replace("'", "''") + "'" for d in departments)
    return f"code_departement IN ({quoted})"


def _create_mutations(con: duckdb.DuckDBPyConnection) -> None:
    habitation = f"type_local IN {HABITATION_TYPES}"
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE mutations AS
        SELECT
            id_mutation,
            count(*) AS n_rows,
            min(nature_mutation) AS nature_mutation,
            min(date_mutation) AS date_mutation,
            count(DISTINCT valeur_fonciere) AS n_prices,
            min(valeur_fonciere) AS valeur_fonciere,
            count(DISTINCT CASE WHEN {habitation} THEN struct_pack(
                p := id_parcelle, t := type_local, s := surface_reelle_bati,
                r := nombre_pieces_principales, l := lot1_numero) END) AS n_habitation_locals,
            count(*) FILTER (WHERE type_local LIKE '{COMMERCIAL_TYPE_PREFIX}%') AS n_commercial_rows,
            min(type_local) FILTER (WHERE {habitation}) AS type_local,
            min(surface_reelle_bati) FILTER (WHERE {habitation}) AS surface_reelle_bati,
            min(code_commune) FILTER (WHERE {habitation}) AS code_commune,
            min(code_departement) FILTER (WHERE {habitation}) AS code_departement,
            median(longitude) FILTER (WHERE {habitation}) AS longitude,
            median(latitude) FILTER (WHERE {habitation}) AS latitude
        FROM src
        GROUP BY id_mutation
        """
    )


def _apply_rules(con: duckdb.DuckDBPyConnection, newest: date) -> dict[str, int]:
    low, high = PRICE_BOUNDS
    rules = [
        ("vente", "nature_mutation = 'Vente'"),
        ("one_habitation_local", "n_habitation_locals = 1"),
        ("no_commercial_local", "n_commercial_rows = 0"),
        ("single_positive_price", "n_prices = 1 AND valeur_fonciere > 0"),
        ("surface_ge_9", f"surface_reelle_bati >= {MIN_SURFACE_M2}"),
        ("price_m2_in_bounds", f"valeur_fonciere / surface_reelle_bati BETWEEN {low} AND {high}"),
        (
            f"within_{FALLBACK_WINDOW_MONTHS}_months",
            f"date_mutation > DATE '{newest.isoformat()}' - INTERVAL {FALLBACK_WINDOW_MONTHS} MONTH",
        ),
    ]
    steps = {
        "source_rows_in_scope": _scalar(con, "SELECT coalesce(sum(n_rows), 0) FROM mutations"),
        "source_mutations_in_scope": _scalar(con, "SELECT count(*) FROM mutations"),
        "vente_rows": _scalar(con, "SELECT coalesce(sum(n_rows), 0) FROM mutations WHERE nature_mutation = 'Vente'"),
    }
    applied: list[str] = []
    for name, predicate in rules:
        applied.append(predicate)
        steps[f"mutations_{name}"] = _scalar(con, f"SELECT count(*) FROM mutations WHERE {' AND '.join(applied)}")
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE sales AS
        SELECT
            code_commune,
            code_departement,
            CASE type_local WHEN 'Maison' THEN 'mai' ELSE 'app' END AS kind,
            date_mutation,
            valeur_fonciere / surface_reelle_bati AS price_m2,
            longitude,
            latitude
        FROM mutations
        WHERE {' AND '.join(applied)}
        """
    )
    con.execute("DROP TABLE mutations")
    return steps


def _scalar(con: duckdb.DuckDBPyConnection, sql: str) -> int:
    return int(con.execute(sql).fetchone()[0])
