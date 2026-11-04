"""Reconcile DVF commune codes with the boundary file's COG year.

geo-DVF codes follow an older COG than the current ADMIN EXPRESS edition, so communes merged since
then appear under their pre-merger code. Unmatched codes are mapped, in order, by:
  1. the ADMIN EXPRESS communes associees / deleguees table (old code -> commune de rattachement);
  2. the boundary commune containing the median location of that code's retained sales
     (mergers that kept no commune deleguee).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import duckdb
import pyarrow as pa

from settling.boundaries import Boundaries, locate

MAX_UNMATCHED_SHARE = 0.005


class UnmatchedCodesError(RuntimeError):
    """Too many retained sales carry a commune code absent from the boundary file."""


@dataclass(frozen=True)
class CodeMapping:
    old: str
    new: str
    sales: int
    method: str


@dataclass(frozen=True)
class JoinReport:
    retained_sales: int
    dvf_codes: int
    unmatched_codes_before: int
    unmatched_sales_before: int
    mappings: list[CodeMapping]
    unmatched_after: dict[str, int] = field(default_factory=dict)
    boundary_communes_without_sales: int = 0

    @property
    def unmatched_sales_after(self) -> int:
        return sum(self.unmatched_after.values())

    @property
    def unmatched_share_after(self) -> float:
        return self.unmatched_sales_after / self.retained_sales if self.retained_sales else 0.0


def reconcile_codes(con: duckdb.DuckDBPyConnection, boundaries: Boundaries) -> JoinReport:
    known = {a.code for a in boundaries.communes}
    con.register("known_codes", pa.table({"code": sorted(known)}))
    dvf_codes = int(con.execute("SELECT count(DISTINCT code_commune) FROM sales").fetchone()[0])
    unmatched = con.execute(
        """
        SELECT code_commune, count(*), median(longitude), median(latitude)
        FROM sales WHERE code_commune NOT IN (SELECT code FROM known_codes)
        GROUP BY 1 ORDER BY 1
        """
    ).fetchall()
    mappings = _map_codes(unmatched, boundaries, known)
    if mappings:
        con.register("code_map", pa.table({"old": [m.old for m in mappings], "new": [m.new for m in mappings]}))
        con.execute("UPDATE sales SET code_commune = code_map.new FROM code_map WHERE sales.code_commune = code_map.old")
    after = con.execute(
        "SELECT code_commune, count(*) FROM sales WHERE code_commune NOT IN (SELECT code FROM known_codes) GROUP BY 1"
    ).fetchall()
    with_sales = {r[0] for r in con.execute("SELECT DISTINCT code_commune FROM sales").fetchall()}
    return JoinReport(
        retained_sales=int(con.execute("SELECT count(*) FROM sales").fetchone()[0]),
        dvf_codes=dvf_codes,
        unmatched_codes_before=len(unmatched),
        unmatched_sales_before=sum(int(r[1]) for r in unmatched),
        mappings=mappings,
        unmatched_after={code: int(n) for code, n in sorted(after)},
        boundary_communes_without_sales=len(known - with_sales),
    )


def check_unmatched(report: JoinReport) -> None:
    if report.unmatched_share_after > MAX_UNMATCHED_SHARE:
        raise UnmatchedCodesError(
            f"{report.unmatched_sales_after} of {report.retained_sales} retained sales "
            f"({report.unmatched_share_after:.2%}) have no boundary match (limit {MAX_UNMATCHED_SHARE:.1%})"
        )


def _map_codes(unmatched: list[tuple], boundaries: Boundaries, known: set[str]) -> list[CodeMapping]:
    mappings: list[CodeMapping] = []
    to_locate: list[tuple] = []
    for code, n, lon, lat in unmatched:
        new = boundaries.merged_codes.get(code)
        if new in known:
            mappings.append(CodeMapping(code, new, int(n), "commune_deleguee"))
        elif lon is not None and lat is not None:
            to_locate.append((code, n, lon, lat))
    located = locate([(lon, lat) for _, _, lon, lat in to_locate], boundaries.communes) if to_locate else []
    for (code, n, _, _), new in zip(to_locate, located):
        if new is not None:
            mappings.append(CodeMapping(code, new, int(n), "sale_location"))
    return mappings
