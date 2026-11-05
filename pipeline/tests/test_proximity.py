from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from shapely.geometry import box

from settling import proximity
from settling.proximity import EquipmentCounts

# Lambert-93 is anchored at 3°E 46.5°N = (700000, 6600000): hand-computable distances around it.
ORIGIN = (703_000.0, 6_604_000.0)
BPE_ROWS = [
    # TYPEQU, EPSG, QUALITE_XY, LAMBERT_X, LAMBERT_Y
    ("D101", "2154", "B", 700_000.0, 6_600_000.0),  # 3-4-5 triangle from ORIGIN: 5000 m
    ("D101", "2154", "A", 710_000.0, 6_600_000.0),
    ("D101", "2154", "M", 707_500.0, 6_604_000.0),  # approximate position (4500 m): kept, and nearest
    ("D101", "2154", "_U", None, None),  # not geolocated: skipped
    ("D101", "2975", "B", 300_000.0, 7_650_000.0),  # La Réunion (UTM 40S): out of scope
    ("D265", "2154", "B", 703_000.0, 6_604_120.0),  # 120 m: rounds to 100
    ("D265", "2154", "B", 0.0, 0.0),  # outside the Lambert-93 extent: invalid
    ("C107", "2154", "B", 703_000.0, 6_604_000.0),  # école maternelle: not a mapped type
    ("C108", "2154", "B", 703_000.0, 6_604_250.0),  # école primaire: 250 m rounds half up to 300
    ("C109", "2154", "A", 703_000.0, 6_605_000.0),
    ("B104", "2154", "B", 713_000.0, 6_604_000.0),  # hypermarché: 10 km
    ("B105", "2154", "B", 703_000.0, 6_594_000.0),  # supermarché: 10 km
    ("B207", "2154", "B", 702_850.0, 6_604_000.0),  # 150 m rounds half up to 200
    ("F101", "2154", "_U", 703_000.0, 6_634_000.0),  # pools have no INSEE quality flag: kept
]


@pytest.fixture
def bpe_file(tmp_path: Path) -> Path:
    columns = ("TYPEQU", "EPSG", "QUALITE_XY", "LAMBERT_X", "LAMBERT_Y")
    table = pa.table({name: [row[i] for row in BPE_ROWS] for i, name in enumerate(columns)})
    path = tmp_path / "bpe.parquet"
    pq.write_table(table, path)
    return path


@pytest.fixture
def distances(bpe_file: Path) -> dict[str, int]:
    found = proximity.nearest_distances(np.asarray([ORIGIN]), proximity.read_equipments(bpe_file))
    return proximity.distance_properties(["X"], found)["X"]


def test_types_map_to_properties_and_bad_rows_are_counted(bpe_file: Path) -> None:
    counts = proximity.read_equipments(bpe_file).counts
    assert counts["d_hos"] == EquipmentCounts(
        kept=3, kept_quality_undetermined=0, kept_approximate=1, skipped_missing_or_invalid_xy=1,
        outside_metropole=1,
    )
    assert counts["d_gp"].kept == 1
    assert counts["d_gp"].skipped_missing_or_invalid_xy == 1
    assert counts["d_sch"].kept == 2  # C108 + C109, not C107
    assert counts["d_sup"].kept == 2  # B104 + B105
    assert counts["d_bak"].kept == 1
    assert counts["d_pool"] == EquipmentCounts(1, 1, 0, 0, 0)  # quality "_U" is kept too


def test_approximately_located_equipment_counts_as_nearest(distances: dict[str, int]) -> None:
    assert distances["d_hos"] == 4500


def test_distances_round_to_100_metres_half_up(distances: dict[str, int]) -> None:
    assert distances == {"d_hos": 4500, "d_gp": 100, "d_sch": 300, "d_sup": 10000, "d_bak": 200, "d_pool": 30000}


@pytest.mark.parametrize(("metres", "expected"), [(0, 0), (49.9, 0), (50, 100), (149.9, 100), (150, 200), (1049, 1000)])
def test_round_to(metres: float, expected: int) -> None:
    assert proximity.round_to(np.asarray([metres]), 100)[0] == expected


def test_type_without_equipment_is_omitted() -> None:
    empty = proximity.Equipments({"d_hos": np.empty((0, 2))}, {})
    found = proximity.nearest_distances(np.asarray([ORIGIN]), empty)
    assert proximity.distance_properties(["X"], found) == {"X": {}}


def test_representative_point_is_inside_and_projected_to_lambert93() -> None:
    (x, y), = proximity.representative_points_l93([box(2.999, 46.499, 3.001, 46.501)])
    assert x == pytest.approx(700_000, abs=100)
    assert y == pytest.approx(6_600_000, abs=150)


def test_quantiles_use_observed_values() -> None:
    summary = proximity.distance_quantiles({"d_gp": np.asarray([100, 200, 300, 400, -1])})
    assert summary["d_gp"]["p0"] == 100
    assert summary["d_gp"]["p100"] == 400
    assert summary["d_gp"]["n"] == 4
    assert summary["d_gp"]["p50"] in (200, 300)
