"""Straight-line distance from each commune to the nearest equipment of each mapped type (INSEE BPE).

Distances are measured in Lambert-93 (EPSG:2154) metres from a representative point of the commune
polygon to the nearest equipment of the type anywhere in metropolitan France and Corsica. Only these
per-commune aggregates leave this module; per-equipment rows never reach the tiles or the reports.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import shapely
from pyproj import Transformer
from scipy.spatial import cKDTree
from shapely.geometry.base import BaseGeometry

# Tile property -> BPE TYPEQU codes, verified against TYPEQU_2025.csv (BPE 2025 metadata).
AMENITIES: dict[str, tuple[str, ...]] = {
    "d_hos": ("D101",),  # établissement de soins de courte durée
    "d_gp": ("D265",),  # médecin généraliste
    "d_sch": ("C108", "C109"),  # école primaire (maternelle + élémentaire), école élémentaire
    "d_sup": ("B104", "B105"),  # hypermarché et grand magasin, supermarché et magasin multi-commerce
    "d_bak": ("B207",),  # boulangerie-pâtisserie
    "d_pool": ("F101",),  # bassin de natation
    "d_col": ("C201",),  # collège
    # lycée général et/ou technologique, professionnel, agricole, plus the general (SGT) and vocational (SEP)
    # sections: 92% of section rows sit within 300 m of a C301-C303 row; the rest are separate teaching sites.
    "d_lyc": ("C301", "C302", "C303", "C304", "C305"),
    "d_pha": ("D307",),  # pharmacie (propharmacies included)
    "d_den": ("D277",),  # chirurgien dentiste (replaces D221 since BPE 2024)
    # établissement d'accueil du jeune enfant (crèche, halte-garderie, micro-crèche PSU), micro-crèche PAJE.
    # Not D503 (lieu d'accueil enfant-parent), D504 (relais petite enfance): no childcare is provided there.
    "d_cre": ("D502", "D509"),
    # bureau de poste, relais poste, agence postale: every La Poste contact point sends letters and parcels.
    "d_pos": ("A206", "A207", "A208"),
    # gare de voyageurs d'intérêt national, régional, local (SNCF): every passenger station, all quality "B".
    "d_gar": ("E107", "E108", "E109"),
}
METROPOLE_EPSG = "2154"
# QUALITE_XY "M" (mauvaise): street only probable, or a random point in the street / commune >= 500 m off.
# Kept: the point is still in the right commune, while dropping it removed whole hospitals (CH Calvi,
# CH Dax, CH Blois) and lengthened 185 communes' hospital distance by more than 5 km.
APPROXIMATE_QUALITY = "M"
# Lambert-93 extent of metropolitan France and Corsica, with a margin; anything outside is a bad coordinate.
L93_BOUNDS = (0.0, 6_000_000.0, 1_300_000.0, 7_200_000.0)
ROUND_TO_M = 100
QUANTILES = (0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1.0)

_TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)


@dataclass(frozen=True)
class EquipmentCounts:
    kept: int
    kept_quality_undetermined: int
    kept_approximate: int
    skipped_missing_or_invalid_xy: int
    outside_metropole: int


@dataclass(frozen=True)
class Equipments:
    coordinates: dict[str, np.ndarray]  # property -> (n, 2) Lambert-93 metres
    counts: dict[str, EquipmentCounts]


def read_equipments(path: Path) -> Equipments:
    type_to_property = {code: prop for prop, codes in AMENITIES.items() for code in codes}
    codes = ", ".join(f"'{code}'" for code in type_to_property)
    rows = duckdb.sql(
        f"""SELECT TYPEQU, EPSG, QUALITE_XY, LAMBERT_X, LAMBERT_Y
        FROM read_parquet('{path.as_posix()}') WHERE TYPEQU IN ({codes})"""
    ).fetchall()
    points: dict[str, list[tuple[float, float]]] = {prop: [] for prop in AMENITIES}
    tallies: dict[str, Counter[str]] = {prop: Counter() for prop in AMENITIES}
    for typequ, epsg, quality, x, y in rows:
        prop = type_to_property[typequ]
        outcome = _classify(epsg, quality, x, y)
        tallies[prop][outcome] += 1
        if outcome.startswith("kept"):
            points[prop].append((x, y))
    return Equipments(
        coordinates={prop: np.asarray(p, dtype=float).reshape(-1, 2) for prop, p in points.items()},
        counts={prop: _counts(tally) for prop, tally in tallies.items()},
    )


def representative_points_l93(geometries: list[BaseGeometry]) -> np.ndarray:
    """(n, 2) Lambert-93 coordinates of a point inside each WGS84 polygon."""
    # deliberate: a point guaranteed inside the polygon, not the town centre (mairie or main village).
    points = shapely.point_on_surface(np.asarray(geometries, dtype=object))
    x, y = _TO_L93.transform(shapely.get_x(points), shapely.get_y(points))
    return np.column_stack((x, y))


def nearest_distances(origins: np.ndarray, equipments: Equipments) -> dict[str, np.ndarray]:
    """Property -> distance in metres, rounded to 100 m, per origin; -1 where the type has no equipment."""
    result: dict[str, np.ndarray] = {}
    for prop, coordinates in equipments.coordinates.items():
        if len(coordinates) == 0:
            result[prop] = np.full(len(origins), -1, dtype=np.int64)
            continue
        distances, _ = cKDTree(coordinates).query(origins, k=1)
        result[prop] = round_to(distances, ROUND_TO_M)
    return result


def round_to(values: np.ndarray, step: int) -> np.ndarray:
    """Round half up to a multiple of `step` (np.round would round half to even)."""
    return (np.floor(np.asarray(values) / step + 0.5) * step).astype(np.int64)


def distance_properties(codes: list[str], distances: dict[str, np.ndarray]) -> dict[str, dict[str, int]]:
    return {
        code: {prop: int(values[i]) for prop, values in distances.items() if values[i] >= 0}
        for i, code in enumerate(codes)
    }


def distance_quantiles(distances: dict[str, np.ndarray]) -> dict[str, dict[str, int]]:
    summary = {}
    for prop, values in distances.items():
        valid = values[values >= 0]
        if len(valid):
            summary[prop] = {
                f"p{round(q * 100)}": int(np.quantile(valid, q, method="nearest")) for q in QUANTILES
            } | {"n": len(valid)}
    return summary


def _classify(epsg: str | None, quality: str | None, x: float | None, y: float | None) -> str:
    if epsg != METROPOLE_EPSG:
        return "outside_metropole"
    if x is None or y is None or not (L93_BOUNDS[0] <= x <= L93_BOUNDS[2] and L93_BOUNDS[1] <= y <= L93_BOUNDS[3]):
        return "skipped_missing_or_invalid_xy"
    if quality == APPROXIMATE_QUALITY:
        return "kept_approximate"
    # Bassins de natation come from Data ES, not from address geocoding, so INSEE leaves their quality "_U".
    if quality not in ("A", "B"):
        return "kept_quality_undetermined"
    return "kept"


def _counts(tally: Counter[str]) -> EquipmentCounts:
    return EquipmentCounts(
        kept=tally["kept"] + tally["kept_quality_undetermined"] + tally["kept_approximate"],
        kept_quality_undetermined=tally["kept_quality_undetermined"],
        kept_approximate=tally["kept_approximate"],
        skipped_missing_or_invalid_xy=tally["skipped_missing_or_invalid_xy"],
        outside_metropole=tally["outside_metropole"],
    )
