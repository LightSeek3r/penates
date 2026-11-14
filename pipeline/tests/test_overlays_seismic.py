import pytest
import shapely
from shapely.geometry import LineString, MultiLineString, box

from settling.boundaries import Area
from settling.overlays.isolines import MAX_PART_M, isolines
from settling.overlays.seismic_lines import SEISMIC_LEVELS, seismic_isolines

# Cells of 0.1 degree (about 7.6 by 11.1 km) around 3°E 46.5°N; the outer edge of the grid is the coast.
LON0, LAT0, CELL = 3.0, 46.5, 0.1
# Tolerance when comparing a line with the edge it should follow: the lines stop short of the coast on purpose.
EDGE_TOLERANCE = 0.0015


def _cell(col: int, row: int) -> Area:
    west, south = LON0 + col * CELL, LAT0 + row * CELL
    return Area(f"{col}{row}", f"cell {col} {row}", "00", box(west, south, west + CELL, south + CELL))


def _grid(zones: list[list[int | None]], missing: set[tuple[int, int]] = frozenset()):
    """Communes of a grid whose rows are given from south to north, with their zones; `missing` cells are sea."""
    communes = [_cell(c, r) for r, row in enumerate(zones) for c, _ in enumerate(row) if (c, r) not in missing]
    by_code = {f"{c}{r}": z for r, row in enumerate(zones) for c, z in enumerate(row) if z is not None}
    return communes, by_code


def _edge(col: int, row: int, side: str) -> LineString:
    west, south = LON0 + col * CELL, LAT0 + row * CELL
    sides = {
        "west": [(west, south), (west, south + CELL)],
        "east": [(west + CELL, south), (west + CELL, south + CELL)],
        "south": [(west, south), (west + CELL, south)],
        "north": [(west, south + CELL), (west + CELL, south + CELL)],
    }
    return LineString(sides[side])


def _drawn(result, level: int) -> MultiLineString:
    return MultiLineString([p.geometry for p in result.parts if p.level == level])


def _assert_follows(result, level: int, expected: list[LineString]) -> None:
    """The lines of `level` cover every expected edge, and nothing else."""
    drawn, wanted = _drawn(result, level), shapely.union_all(expected)
    assert shapely.difference(wanted, drawn.buffer(EDGE_TOLERANCE)).length < EDGE_TOLERANCE
    assert shapely.difference(drawn, wanted.buffer(EDGE_TOLERANCE)).length == 0


def test_lines_follow_the_changes_of_zone_and_never_the_outer_edge() -> None:
    communes, zones = _grid([[1, 2, 3], [1, 2, 3]])
    result = seismic_isolines(communes, zones)
    assert result.lines == {2: 1, 3: 1}
    _assert_follows(result, 2, [_edge(1, 0, "west"), _edge(1, 1, "west")])
    _assert_follows(result, 3, [_edge(2, 0, "west"), _edge(2, 1, "west")])
    outline = shapely.union_all([a.geometry for a in communes]).boundary
    assert all(part.geometry.distance(outline) > 0.0002 for part in result.parts)


def test_a_line_length_is_in_metres() -> None:
    communes, zones = _grid([[1, 2], [1, 2]])
    result = seismic_isolines(communes, zones)
    two_cells_north_south = 2 * CELL * 111_200
    assert result.length_m[2] == pytest.approx(two_cells_north_south, rel=0.02)
    assert sum(part.length_m for part in result.parts) == pytest.approx(result.length_m[2], rel=1e-9)


def test_a_zone_that_jumps_two_levels_has_a_line_for_each_level() -> None:
    communes, zones = _grid([[1, 3], [1, 2], [2, 3]])
    result = seismic_isolines(communes, zones)
    assert set(result.lines) == {2, 3}
    # level 2: everything that is zone 2 or more against zone 1; level 3: the zone 3 cells against the rest
    _assert_follows(result, 2, [_edge(1, 0, "west"), _edge(1, 1, "west"), _edge(0, 2, "south")])
    _assert_follows(result, 3, [_edge(1, 0, "west"), _edge(1, 0, "north"), _edge(1, 2, "south"), _edge(1, 2, "west")])


def test_a_bay_ends_the_line_at_the_water() -> None:
    communes, zones = _grid([[1, 2, 3]] * 3, missing={(1, 0)})  # the south cell of the middle column is sea
    result = seismic_isolines(communes, zones)
    # between the zones the line runs along the two northern rows only; the south row meets the water instead
    _assert_follows(result, 2, [_edge(1, 1, "west"), _edge(1, 2, "west")])
    _assert_follows(result, 3, [_edge(2, 1, "west"), _edge(2, 2, "west")])
    south_row_top = LAT0 + CELL
    assert all(shapely.get_coordinates(p.geometry)[:, 1].min() >= south_row_top - 0.0005 for p in result.parts)


def test_a_commune_without_a_zone_draws_no_line() -> None:
    communes, zones = _grid([[1, None, 3]])
    result = seismic_isolines(communes, zones)
    assert result.parts == []
    assert result.lines == {3: 0}


def test_a_level_nobody_has_gets_no_line_of_its_own() -> None:
    communes, zones = _grid([[1, 3]])
    assert set(seismic_isolines(communes, zones).lines) == {3}


def test_a_uniform_zone_has_no_line_at_all() -> None:
    communes, zones = _grid([[2, 2], [2, 2]])
    result = seismic_isolines(communes, zones)
    assert result.parts == []
    assert result.lines == {2: 0}


def test_long_lines_are_cut_into_tile_sized_parts() -> None:
    communes, zones = _grid([[1, 2]] * 14)  # 14 cells north to south: a line of about 155 km
    result = seismic_isolines(communes, zones)
    assert result.lines == {2: 1}
    lengths = [part.length_m for part in result.parts]
    assert len(lengths) >= 5
    assert max(lengths) < MAX_PART_M + 12_000, "a part ends at the first vertex past the limit, one cell at most"
    assert sum(lengths) == pytest.approx(result.length_m[2], rel=1e-9)
    joined = shapely.line_merge(MultiLineString([p.geometry for p in result.parts]))
    assert joined.geom_type == "LineString", "the parts share their end points"


# The same lines for any commune-level value: the risk overlays use them with their own levels.

def test_the_seismic_levels_are_the_zones_above_1() -> None:
    assert SEISMIC_LEVELS == (2, 3, 4, 5)


def test_levels_are_thresholds_on_values_that_can_jump_far() -> None:
    communes, values = _grid([[0, 3, 7, 30]])  # recorded cavities per commune
    result = isolines(communes, values, (1, 5, 25))
    assert result.lines == {1: 1, 5: 1, 25: 1}
    _assert_follows(result, 1, [_edge(1, 0, "west")])
    _assert_follows(result, 5, [_edge(2, 0, "west")])
    _assert_follows(result, 25, [_edge(3, 0, "west")])


def test_a_level_between_two_values_nobody_has_repeats_the_next_level_so_it_is_left_out() -> None:
    communes, values = _grid([[0, 2, 2]])
    result = isolines(communes, values, (1, 2))
    assert set(result.lines) == {2}, "nobody has exactly 1: the line of level 1 would repeat level 2"
    _assert_follows(result, 2, [_edge(1, 0, "west")])


def test_a_level_nobody_reaches_gets_no_entry() -> None:
    communes, values = _grid([[0, 3, 7]])
    assert set(isolines(communes, values, (1, 5, 25)).lines) == {1, 5}


def test_ground_without_a_value_is_unknown_and_never_bounds_a_class() -> None:
    # three columns; the middle one is class 0 except its centre cell, which has no value. The class 3 column to the
    # east rises from 0 along its west edge, but not along the stretch that faces the unknown cell.
    communes, values = _grid([[0, 0, 3], [0, None, 3], [0, 0, 3]])
    result = isolines(communes, values, (1,))
    _assert_follows(result, 1, [_edge(2, 0, "west"), _edge(2, 2, "west")])


def test_ground_without_a_value_is_not_class_zero_even_when_it_is_the_only_neighbour() -> None:
    communes, values = _grid([[None, 3]])
    result = isolines(communes, values, (1,))
    assert result.parts == []
    assert result.lines == {1: 0}


def test_no_value_at_all_gives_no_line_and_no_error() -> None:
    communes, _ = _grid([[1, 2]])
    result = isolines(communes, {}, (1, 2))
    assert (result.parts, result.lines, result.length_m) == ([], {}, {})
