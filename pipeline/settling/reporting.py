"""Aggregate-only sections of build-report.json (no per-sale values)."""

from __future__ import annotations

import statistics
from collections import defaultdict

from pmtiles.tile import tileid_to_zxy

from settling import aggregate as agg
from settling.aggregate import AreaResult as Result

PLM_PREFIXES = {"paris": "751", "lyon": "6938", "marseille": "132"}
CHEAP_DEPARTMENT = "23"
CHEAP_THRESHOLD = 1500
LARGEST_N = 10


def area_rows(results: list[Result]) -> list[list]:
    """[code, kind, n, p25, median, p75, window_months, start, end] for each area's chosen window."""
    rows = []
    for r in results:
        w = r.stats.window
        for kind, s in r.stats.by_kind.items():
            rows.append([r.area.code, kind, s.n, round(s.p25), round(s.median), round(s.p75),
                         w.months, str(w.start), str(w.end)])
    return rows


def spot_checks(communes: list[Result], departments: list[Result]) -> dict:
    checks: dict = {
        city: [_summary(r) for r in communes if r.area.code.startswith(prefix) and r.area.dep == prefix[:2]]
        for city, prefix in PLM_PREFIXES.items()
    }
    checks["creuse_23"] = _department_summary([r for r in communes if r.area.dep == CHEAP_DEPARTMENT])
    checks["no_coverage_departments"] = [
        _summary(r) for r in departments if r.area.code in agg.NO_COVERAGE_DEPARTMENTS
    ]
    by_n = sorted((r for r in communes if "n_all" in r.properties), key=lambda r: -int(r.properties["n_all"]))
    checks["largest_n_communes"] = [_summary(r) for r in by_n[:LARGEST_N]]
    return checks


def tile_stats(tiles: dict[int, bytes]) -> dict:
    per_zoom: dict[int, list[int]] = defaultdict(list)
    for tile_id, data in tiles.items():
        per_zoom[tileid_to_zxy(tile_id)[0]].append(len(data))
    return {
        "tiles": len(tiles),
        "bytes": sum(len(d) for d in tiles.values()),
        "per_zoom": {z: {"tiles": len(s), "bytes": sum(s), "max_tile_bytes": max(s)} for z, s in sorted(per_zoom.items())},
    }


def _summary(r: Result) -> dict:
    keys = ("p_all", "n_all", "c_all", "p_mai", "n_mai", "p_app", "n_app", "w")
    return {"code": r.area.code, "name": r.area.name} | {k: r.properties[k] for k in keys if k in r.properties}


def _department_summary(results: list[Result]) -> dict:
    medians = [int(r.properties["p_all"]) for r in results if "p_all" in r.properties]
    by_n = sorted(results, key=lambda r: -int(r.properties.get("n_all", 0)))
    return {
        "communes": len(results),
        "communes_with_price": len(medians),
        "median_of_commune_medians": round(statistics.median(medians)) if medians else None,
        f"share_under_{CHEAP_THRESHOLD}": round(sum(m < CHEAP_THRESHOLD for m in medians) / len(medians), 3)
        if medians else None,
        "largest_n": [_summary(r) for r in by_n[:5]],
    }


SPOT_COMMUNES = {
    "31555": "Toulouse", "69383": "Lyon 3e", "75106": "Paris 6e", "67482": "Strasbourg",
    "06088": "Nice", "48095": "Mende",
}
REMOTE_N = 10


def indicator_spot_checks(communes: list[Result], indicators: dict[str, dict[str, int]]) -> dict:
    """Seismic zone and distances of a few known communes, plus the communes farthest from a hospital."""
    names = {r.area.code: r.area.name for r in communes}
    farthest = sorted(indicators, key=lambda code: -indicators[code].get("d_hos", -1))[:REMOTE_N]
    return {
        "known": [{"code": c, "name": names[c]} | indicators[c] for c in SPOT_COMMUNES if c in indicators],
        "farthest_from_hospital": [{"code": c, "name": names[c]} | indicators[c] for c in farthest],
    }
