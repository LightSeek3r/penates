"""Commune and department geometries from ADMIN EXPRESS COG-CARTO-PE GeoParquet (WKB, WGS84)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely.geometry.base import BaseGeometry

# DVF reports Paris, Lyon and Marseille sales under municipal-arrondissement codes
# (75101.., 69381.., 13201..), never under the parent commune codes.
PLM_PARENT_CODES = frozenset({"75056", "69123", "13055"})
OVERSEAS_PREFIX = "97"
GEOMETRY_COLUMN = "geometrie"


@dataclass(frozen=True)
class Area:
    code: str
    name: str
    dep: str
    geometry: BaseGeometry


@dataclass(frozen=True)
class Boundaries:
    communes: list[Area]
    departments: list[Area]
    # old commune code -> current commune code (communes associees / deleguees of a merger)
    merged_codes: dict[str, str]


def load_boundaries(paths: dict[str, Path], departments: list[str] | None) -> Boundaries:
    communes = read_areas(paths["commune"], dep_column="code_insee_du_departement")
    arrondissements = read_areas(paths["arrondissement_municipal"], dep_column=None)
    deps = read_areas(paths["departement"], dep_column="code_insee")
    keep = _scope(departments)
    return Boundaries(
        communes=[a for a in assemble_communes(communes, arrondissements) if keep(a.dep)],
        departments=[d for d in deps if keep(d.dep)],
        merged_codes=read_merged_codes(paths["commune_associee_ou_deleguee"]),
    )


def assemble_communes(communes: list[Area], arrondissements: list[Area]) -> list[Area]:
    """Replace the Paris/Lyon/Marseille communes by their municipal arrondissements."""
    return [c for c in communes if c.code not in PLM_PARENT_CODES] + arrondissements


def read_areas(path: Path, dep_column: str | None) -> list[Area]:
    columns = ["code_insee", "nom_officiel", GEOMETRY_COLUMN] + ([dep_column] if dep_column else [])
    table = pq.read_table(path, columns=list(dict.fromkeys(columns)))
    codes = table["code_insee"].to_pylist()
    names = table["nom_officiel"].to_pylist()
    deps = table[dep_column].to_pylist() if dep_column else [department_of(c) for c in codes]
    geometries = shapely.from_wkb(np.asarray(table[GEOMETRY_COLUMN].to_pylist(), dtype=object))
    geometries = shapely.make_valid(geometries)
    return [Area(c, n, d, g) for c, n, d, g in zip(codes, names, deps, geometries)]


def read_merged_codes(path: Path) -> dict[str, str]:
    table = pq.read_table(path, columns=["code_insee", "code_insee_de_la_commune_de_rattach"])
    pairs = zip(table["code_insee"].to_pylist(), table["code_insee_de_la_commune_de_rattach"].to_pylist())
    return {old: new for old, new in pairs if old and new and old != new}


def department_of(commune_code: str) -> str:
    return commune_code[:3] if commune_code.startswith(OVERSEAS_PREFIX) else commune_code[:2]


def locate(points: list[tuple[float, float]], areas: list[Area]) -> list[str | None]:
    """Code of the area containing each (lon, lat) point, or None."""
    tree = shapely.STRtree([a.geometry for a in areas])
    query = shapely.points(np.asarray(points, dtype=float).reshape(-1, 2))
    point_idx, area_idx = tree.query(query, predicate="within")
    found: list[str | None] = [None] * len(points)
    for p, a in zip(point_idx, area_idx):
        found[p] = areas[a].code
    return found


def _scope(departments: list[str] | None):
    if departments is None:
        return lambda dep: not dep.startswith(OVERSEAS_PREFIX)
    wanted = set(departments)
    return lambda dep: dep in wanted
