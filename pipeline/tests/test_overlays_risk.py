import json
import re
from pathlib import Path

import pytest
import shapely
from pmtiles.reader import MmapSource, all_tiles
from shapely.geometry import LineString, MultiLineString, box

from communes_archive import write_communes_archive
from settling.boundaries import Area
from settling.overlays.commune_classes import CommunesArchiveError, read_commune_classes
from settling.overlays.risk_lines import RISKS, SOURCE_PROPERTIES, risk_isolines
from settling.tiles import TileFeature, TileLayer, build_tiles, to_web_mercator, write_pmtiles

APP_CATALOGUE = Path(__file__).parents[2] / "app" / "src" / "domain" / "overlays.ts"
# Cells of 0.1 degree around 3°E 46.5°N, in a layer that starts at z4 like the communes of the real archive.
LON0, LAT0, CELL = 3.0, 46.5, 0.1
EDGE_TOLERANCE = 0.0015


def _cell(col: int, row: int, code: str | None = None) -> Area:
    west, south = LON0 + col * CELL, LAT0 + row * CELL
    return Area(code or f"{col}{row}", f"cell {col} {row}", "00", box(west, south, west + CELL, south + CELL))


def _drawn(result, level: int) -> MultiLineString:
    return MultiLineString([p.geometry for p in result.parts if p.level == level])


def _edge_west(col: int, row: int) -> LineString:
    west, south = LON0 + col * CELL, LAT0 + row * CELL
    return LineString([(west, south), (west, south + CELL)])


def test_the_risk_table_matches_the_app() -> None:
    if not APP_CATALOGUE.exists():
        pytest.skip("the app catalogue is not in this checkout")
    text = APP_CATALOGUE.read_text(encoding="utf-8")
    # the table was called COMMUNE_RISKS, with `steps`, until the app moved all risks to the overlays archive
    block = re.search(r"export const (?:RISK_LINES|COMMUNE_RISKS) = \{(.*?)\} as const", text, re.DOTALL)
    assert block, "the risk table is not in overlays.ts any more: update the pipeline table and this test"
    declared = {
        id_: (prop, tuple(int(n) for n in levels.split(",")))
        for id_, prop, levels in re.findall(r"(\w+): \{ property: '(\w+)', (?:levels|steps): \[([\d, ]+)\] \}", block[1])
    }
    assert declared == {id_: (risk.property, risk.levels) for id_, risk in RISKS.items()}


def test_the_risk_table_is_ascending_and_its_properties_are_distinct() -> None:
    assert all(list(risk.levels) == sorted(set(risk.levels)) for risk in RISKS.values())
    assert len(set(SOURCE_PROPERTIES)) == len(RISKS)


def test_classes_are_read_from_the_first_zoom_and_a_missing_property_is_not_zero(tmp_path: Path) -> None:
    communes = {
        "01001": (_cell(0, 0), {"fl": 0, "cl": 2, "rn": 3, "cv": 12}),
        "01002": (_cell(1, 0), {"fl": 3, "cl": 0, "rn": 1}),  # no cv: not 0
        "69381": (_cell(2, 0), {"fl": 1, "cl": 1, "rn": 2, "cv": 0}),  # an arrondissement code, kept as is
        "01004": (_cell(3, 0), {}),
    }
    classes = read_commune_classes(write_communes_archive(tmp_path / "communes.pmtiles", communes), SOURCE_PROPERTIES)
    assert classes.zoom == 4
    assert classes.communes == set(communes)
    assert classes.values["fl"] == {"01001": 0, "01002": 3, "69381": 1}
    assert classes.values["cv"] == {"01001": 12, "69381": 0}, "a commune without cv has no value"
    assert "01004" not in classes.values["rn"]
    assert classes.version == "2026-11-06"


def test_a_commune_cut_by_a_tile_border_is_merged_into_one_value(tmp_path: Path) -> None:
    straddling = Area("01001", "straddling", "01", box(-0.2, 46.0, 0.2, 46.1))  # the z4 tiles meet at longitude 0
    path = write_communes_archive(tmp_path / "communes.pmtiles", {"01001": (straddling, {"fl": 2, "cv": 9})})
    with path.open("rb") as handle:
        assert len([t for t in all_tiles(MmapSource(handle)) if t[0][0] == 4]) == 2, "the fixture must span two tiles"
    classes = read_commune_classes(path, ["fl", "cv"])
    assert classes.values == {"fl": {"01001": 2}, "cv": {"01001": 9}}
    assert classes.communes == {"01001"}


def test_a_whole_number_stored_as_a_float_is_an_integer_value(tmp_path: Path) -> None:
    path = write_communes_archive(tmp_path / "communes.pmtiles", {"01001": (_cell(0, 0), {"cv": 9.0})})
    value = read_commune_classes(path, ["cv"]).values["cv"]["01001"]
    assert value == 9 and isinstance(value, int)


def test_a_fractional_value_is_refused(tmp_path: Path) -> None:
    path = write_communes_archive(tmp_path / "communes.pmtiles", {"01001": (_cell(0, 0), {"cv": 9.5})})
    with pytest.raises(CommunesArchiveError, match="not a whole number"):
        read_commune_classes(path, ["cv"])


def test_two_features_of_one_commune_that_disagree_are_refused(tmp_path: Path) -> None:
    geometries = to_web_mercator([_cell(0, 0).geometry] * 2)
    features = [TileFeature(i, {"code": "01001", "fl": fl}, g) for i, (fl, g) in enumerate(zip((1, 2), geometries), start=1)]
    path = tmp_path / "communes.pmtiles"
    write_pmtiles(
        path, build_tiles([TileLayer("communes", 4, 4, features)], workers=1),
        {"vector_layers": [{"id": "communes", "minzoom": 4, "maxzoom": 4}]}, (2, 46, 4, 47), (3, 46.5, 4),
    )
    with pytest.raises(CommunesArchiveError, match="01001 has fl=1 in one tile and 2 in another"):
        read_commune_classes(path, ["fl"])


def test_the_version_falls_back_to_the_manifest_next_to_thewrite_communes_archive(tmp_path: Path) -> None:
    path = write_communes_archive(tmp_path / "communes.pmtiles", {"01001": (_cell(0, 0), {"fl": 1})}, metadata={"version": None})
    assert read_commune_classes(path, ["fl"]).version is None
    (tmp_path / "manifest.json").write_text(json.dumps({"version": "2026-10-01"}), encoding="utf-8")
    assert read_commune_classes(path, ["fl"]).version == "2026-10-01"


def test_a_file_that_is_not_a_communes_archive_is_refused(tmp_path: Path) -> None:
    garbage = tmp_path / "garbage.pmtiles"
    garbage.write_bytes(b"<html>blocked by a proxy</html>")
    with pytest.raises(CommunesArchiveError, match="not a PMTiles archive"):
        read_commune_classes(garbage, ["fl"])
    other = tmp_path / "other.pmtiles"
    geometries = to_web_mercator([_cell(0, 0).geometry])
    tiles = build_tiles([TileLayer("departments", 0, 4, [TileFeature(1, {"code": "01"}, geometries[0])])], workers=1)
    write_pmtiles(other, tiles, {"vector_layers": [{"id": "departments", "minzoom": 0, "maxzoom": 4}]}, (2, 46, 4, 47), (3, 46.5, 4))
    with pytest.raises(CommunesArchiveError, match="no 'communes' layer"):
        read_commune_classes(other, ["fl"])


def test_risk_lines_use_each_ids_own_levels_and_values(tmp_path: Path) -> None:
    # a row of four communes: flood 0,1,2,3 and cavities 0,3,7,30
    cells = {f"{c}0": (_cell(c, 0), {"fl": c, "cv": (0, 3, 7, 30)[c]}) for c in range(4)}
    classes = read_commune_classes(write_communes_archive(tmp_path / "communes.pmtiles", cells), SOURCE_PROPERTIES)
    result = risk_isolines([area for area, _ in cells.values()], classes)
    assert result.by_risk["flood"].lines == {1: 1, 2: 1, 3: 1}
    assert result.by_risk["cavities"].lines == {1: 1, 5: 1, 25: 1}
    assert result.by_risk["clay"].lines == {} and result.by_risk["radon"].lines == {}, "no commune has cl or rn"
    flood_3 = _drawn(result.by_risk["flood"], 3)
    assert shapely.difference(_edge_west(3, 0), flood_3.buffer(EDGE_TOLERANCE)).length < EDGE_TOLERANCE
    assert shapely.difference(flood_3, _edge_west(3, 0).buffer(EDGE_TOLERANCE)).length == 0


def test_a_commune_without_the_property_stops_the_line_but_not_the_other_overlays(tmp_path: Path) -> None:
    # 3 columns by 3 rows; flood and cavities rise along the west edge of the east column, cavities are unknown at the centre
    cells = {}
    for col in range(3):
        for row in range(3):
            properties = {"fl": 0 if col < 2 else 1, "cv": 0 if col < 2 else 8}
            if (col, row) == (1, 1):
                properties.pop("cv")
            cells[f"{col}{row}"] = (_cell(col, row), properties)
    classes = read_commune_classes(write_communes_archive(tmp_path / "communes.pmtiles", cells), SOURCE_PROPERTIES)
    result = risk_isolines([area for area, _ in cells.values()], classes)

    flood = _drawn(result.by_risk["flood"], 1)
    whole_edge = shapely.union_all([_edge_west(2, row) for row in range(3)])
    assert shapely.difference(whole_edge, flood.buffer(EDGE_TOLERANCE)).length < EDGE_TOLERANCE

    cavities = _drawn(result.by_risk["cavities"], 5)
    wanted = shapely.union_all([_edge_west(2, 0), _edge_west(2, 2)])
    assert shapely.difference(wanted, cavities.buffer(EDGE_TOLERANCE)).length < EDGE_TOLERANCE
    assert shapely.difference(cavities, wanted.buffer(EDGE_TOLERANCE)).length == 0, "nothing along the unknown cell"
    assert result.without_value["cavities"] == ["11"]
    assert result.without_value["flood"] == []
    assert result.without_value["clay"] == [f"{c}{r}" for c in range(3) for r in range(3)]


def test_communes_of_the_archive_without_a_boundary_are_reported(tmp_path: Path) -> None:
    cells = {"00": (_cell(0, 0), {"fl": 1}), "10": (_cell(1, 0), {"fl": 2}), "99": (_cell(5, 5), {"fl": 3})}
    classes = read_commune_classes(write_communes_archive(tmp_path / "communes.pmtiles", cells), SOURCE_PROPERTIES)
    result = risk_isolines([cells["00"][0], cells["10"][0], _cell(2, 0, "20")], classes)
    assert result.without_boundary == ["99"]
    assert result.without_value["flood"] == ["20"]
