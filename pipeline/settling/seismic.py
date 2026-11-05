"""Seismic zone (1 very low .. 5 strong, décret 2010-1255) per tile commune, from Géorisques.

The Géorisques API answers by INSEE code in its own COG year, so a tile commune is resolved, in order:
  1. its own code;
  2. for a Paris/Lyon/Marseille municipal arrondissement, the parent commune's code;
  3. for a commune absent from the API (merged after the API's COG year), the highest zone among the
     former communes (communes associées / déléguées) attached to it;
  4. for a commune still unresolved (restored after the API's COG year, or simply absent), the highest
     zone among the communes it touches, or, for an island, of the nearest commune.
"""

from __future__ import annotations

import csv
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from pathlib import Path

import shapely

from settling.boundaries import Area

PLM_PARENTS = {"751": "75056", "6938": "69123", "132": "13055"}
ZONES = range(1, 6)
CSV_COLUMNS = ("code_insee", "code_zone")


@dataclass(frozen=True)
class SeismicReport:
    zones_in_source: int
    communes: int
    by_method: dict[str, int]
    by_zone: dict[int, int]
    from_former_communes: list[dict] = field(default_factory=list)
    from_neighbours: list[dict] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)


def plm_parent(code: str) -> str | None:
    """Parent commune of a municipal arrondissement (75101 -> 75056), else None."""
    for prefix, parent in PLM_PARENTS.items():
        if code.startswith(prefix) and code != parent:
            return parent
    return None


def codes_to_query(commune_codes: Iterable[str], merged_codes: dict[str, str]) -> list[str]:
    """Tile codes, PLM parents and every former commune code: one API pass covers all fallbacks."""
    wanted = set(commune_codes)
    wanted |= {parent for code in wanted if (parent := plm_parent(code))}
    wanted |= {old for old, new in merged_codes.items() if new in wanted}
    return sorted(wanted)


def assign_zones(
    commune_codes: list[str], source: dict[str, int], merged_codes: dict[str, str]
) -> tuple[dict[str, int], SeismicReport]:
    former: dict[str, list[str]] = {}
    for old, new in merged_codes.items():
        former.setdefault(new, []).append(old)
    zones: dict[str, int] = {}
    methods: Counter[str] = Counter()
    via_former: list[dict] = []
    missing: list[str] = []
    for code in commune_codes:
        parent = plm_parent(code)
        former_zones = {old: source[old] for old in sorted(former.get(code, [])) if old in source}
        if code in source:
            zones[code], method = source[code], "own_code"
        elif parent in source:
            zones[code], method = source[parent], "plm_parent"
        elif former_zones:
            # deliberate: the highest zone of the former communes, the stricter building rule applies there.
            zones[code], method = max(former_zones.values()), "former_communes"
            via_former.append({"code": code, "zone": zones[code], "former": former_zones})
        else:
            missing.append(code)
            continue
        methods[method] += 1
    report = SeismicReport(
        zones_in_source=len(source),
        communes=len(commune_codes),
        by_method=dict(sorted(methods.items())),
        by_zone=dict(sorted(Counter(zones.values()).items())),
        from_former_communes=via_former,
        missing=missing,
    )
    return zones, report


def fill_from_neighbours(
    zones: dict[str, int], report: SeismicReport, communes: list[Area]
) -> tuple[dict[str, int], SeismicReport]:
    """Resolve `report.missing` from touching communes (rule 4); what stays unresolved stays missing."""
    if not report.missing:
        return zones, report
    geometries = [a.geometry for a in communes]
    index = {a.code: i for i, a in enumerate(communes)}
    tree = shapely.STRtree(geometries)
    zones = dict(zones)
    via_neighbours: list[dict] = []
    missing: list[str] = []
    for code in report.missing:
        geometry = geometries[index[code]]
        near = [i for i in tree.query(geometry, predicate="intersects") if communes[i].code != code]
        if not near:
            near = list(tree.query_nearest(geometry, exclusive=True))
        neighbour_zones = {communes[i].code: zones[communes[i].code] for i in near if communes[i].code in zones}
        if not neighbour_zones:
            missing.append(code)
            continue
        # deliberate: the highest neighbouring zone; zoning is by commune, so a border case is rounded up.
        zones[code] = max(neighbour_zones.values())
        via_neighbours.append({"code": code, "zone": zones[code], "neighbours": dict(sorted(neighbour_zones.items()))})
    methods = report.by_method | ({"neighbours": len(via_neighbours)} if via_neighbours else {})
    return zones, replace(
        report,
        by_method=dict(sorted(methods.items())),
        by_zone=dict(sorted(Counter(zones.values()).items())),
        from_neighbours=via_neighbours,
        missing=missing,
    )


def parse_zone(value: object) -> int | None:
    try:
        zone = int(str(value).strip()[:1])
    except ValueError:
        return None
    return zone if zone in ZONES else None


def read_zone_csv(path: Path) -> dict[str, int]:
    with path.open(encoding="utf-8", newline="") as f:
        rows = csv.DictReader(f)
        return {row["code_insee"]: zone for row in rows if row["code_insee"] and (zone := parse_zone(row["code_zone"]))}


def write_zone_csv(path: Path, zones: dict[str, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    with partial.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_COLUMNS)
        writer.writerows(sorted(zones.items()))
    partial.replace(path)
