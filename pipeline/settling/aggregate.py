"""Per-area aggregates (commune or department x property type) and their tile properties."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import duckdb

from settling.boundaries import Area
from settling.clean import FALLBACK_WINDOW_MONTHS

KINDS = ("all", "mai", "app")
PRIMARY_WINDOW_MONTHS = 36
MIN_N_PRIMARY_WINDOW = 10
TREND_YEARS = range(2021, 2026)
# deliberate: a yearly median from fewer sales is noise, not trend; the trend point is omitted.
MIN_N_YEARLY = 5
NO_COVERAGE_DEPARTMENTS = frozenset({"57", "67", "68"})
NO_COVERAGE_COMMUNE_PREFIX = "976"
NO_COVERAGE = 4

Key = tuple[str, str, int]


@dataclass(frozen=True)
class Stat:
    n: int
    p25: float
    median: float
    p75: float


@dataclass(frozen=True)
class Window:
    months: int
    start: date
    end: date

    @property
    def period(self) -> str:
        return f"{self.start:%Y-%m}/{self.end:%Y-%m}"


@dataclass(frozen=True)
class AreaStats:
    window: Window
    by_kind: dict[str, Stat]
    yearly: dict[int, int]
    no_coverage: bool


@dataclass(frozen=True)
class AreaResult:
    area: Area
    stats: AreaStats
    properties: dict[str, int | str]


def windows(con: duckdb.DuckDBPyConnection, newest: date) -> dict[int, Window]:
    result = {}
    for months in (PRIMARY_WINDOW_MONTHS, FALLBACK_WINDOW_MONTHS):
        start = con.execute(f"SELECT CAST(DATE '{newest}' - INTERVAL {months} MONTH AS DATE) + 1").fetchone()[0]
        result[months] = Window(months, start, newest)
    return result


def compute_stats(con: duckdb.DuckDBPyConnection, key_column: str, primary_start: date) -> dict[Key, Stat]:
    """Stats keyed by (area, kind, window months); the `sales` table already spans the fallback window."""
    rows = con.execute(
        f"""
        WITH s AS (
            SELECT {key_column} AS area, kind, price_m2, {FALLBACK_WINDOW_MONTHS} AS months FROM sales
            UNION ALL
            SELECT {key_column}, kind, price_m2, {PRIMARY_WINDOW_MONTHS} FROM sales
            WHERE date_mutation >= DATE '{primary_start}'
        )
        SELECT area, coalesce(kind, 'all'), months, count(*), quantile_cont(price_m2, [0.25, 0.5, 0.75])
        FROM s
        GROUP BY GROUPING SETS ((area, kind, months), (area, months))
        """
    ).fetchall()
    return {(area, kind, months): Stat(int(n), *q) for area, kind, months, n, q in rows}


def yearly_medians(con: duckdb.DuckDBPyConnection, key_column: str) -> dict[str, dict[int, int]]:
    rows = con.execute(
        f"""
        SELECT {key_column}, year(date_mutation) AS y, median(price_m2)
        FROM sales
        WHERE year(date_mutation) BETWEEN {TREND_YEARS.start} AND {TREND_YEARS.stop - 1}
        GROUP BY ALL
        HAVING count(*) >= {MIN_N_YEARLY}
        """
    ).fetchall()
    result: dict[str, dict[int, int]] = {}
    for area, year, median in rows:
        result.setdefault(area, {})[int(year)] = round(median)
    return result


def area_stats(
    area: str,
    no_coverage: bool,
    stats: dict[Key, Stat],
    yearly: dict[str, dict[int, int]],
    window_by_months: dict[int, Window],
) -> AreaStats:
    months = choose_window_months(area, stats)
    by_kind = {kind: stats[(area, kind, months)] for kind in KINDS if (area, kind, months) in stats}
    return AreaStats(window_by_months[months], by_kind, yearly.get(area, {}), no_coverage)


def choose_window_months(area: str, stats: dict[Key, Stat]) -> int:
    """36 months, unless the area has fewer than 10 sales there and the 60-month window has more."""
    n_primary = _n(stats, (area, "all", PRIMARY_WINDOW_MONTHS))
    n_fallback = _n(stats, (area, "all", FALLBACK_WINDOW_MONTHS))
    if n_primary < MIN_N_PRIMARY_WINDOW and n_fallback > n_primary:
        return FALLBACK_WINDOW_MONTHS
    return PRIMARY_WINDOW_MONTHS


def confidence(n: int) -> int:
    if n >= 30:
        return 3
    if n >= 10:
        return 2
    if n >= 1:
        return 1
    return 0


def is_no_coverage(code: str, dep: str) -> bool:
    return dep in NO_COVERAGE_DEPARTMENTS or code.startswith(NO_COVERAGE_COMMUNE_PREFIX)


def tile_properties(stats: AreaStats, with_trend: bool) -> dict[str, int | str]:
    """Price properties per the tile contract: integers only, absent values omitted."""
    if stats.no_coverage:
        return {f"c_{kind}": NO_COVERAGE for kind in KINDS}
    props: dict[str, int | str] = {"w": stats.window.months, "period": stats.window.period}
    for kind in KINDS:
        stat = stats.by_kind.get(kind)
        n = stat.n if stat else 0
        props[f"n_{kind}"] = n
        props[f"c_{kind}"] = confidence(n)
        if stat:
            props[f"p_{kind}"] = round(stat.median)
    if with_trend:
        props.update({f"t{year}": value for year, value in sorted(stats.yearly.items())})
    return props


def _n(stats: dict[Key, Stat], key: Key) -> int:
    stat = stats.get(key)
    return stat.n if stat else 0
