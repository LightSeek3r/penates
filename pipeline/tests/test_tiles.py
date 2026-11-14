import gzip
from pathlib import Path

import mapbox_vector_tile
from pmtiles.reader import MmapSource, Reader
from pmtiles.tile import Compression, TileType, tileid_to_zxy
from shapely.geometry import LineString, MultiPoint, Point, box

from settling.build import feature_id
from settling.tiles import EXTENT, TileFeature, TileLayer, build_tiles, tile_bounds, to_web_mercator, write_pmtiles

ZOOM = 6
# All three boxes sit inside z6 tile (32, 22), around Paris.
POLYGONS = {
    "75101": box(2.30, 48.80, 2.40, 48.90),
    "2A004": box(2.50, 48.80, 2.60, 48.90),
    "01001": box(2.70, 48.80, 2.80, 48.90),
}


def _write_sample(path: Path) -> None:
    geometries = to_web_mercator(list(POLYGONS.values()))
    features = [
        TileFeature(feature_id(code), {"code": code, "p_all": 1000 * (i + 1), "c_all": 3}, geometry)
        for i, (code, geometry) in enumerate(zip(POLYGONS, geometries))
    ]
    tiles = build_tiles([TileLayer("communes", ZOOM, ZOOM, features)], workers=1)
    write_pmtiles(path, tiles, {"name": "test"}, (2.3, 48.8, 2.8, 48.9), (2.5, 48.85, ZOOM))


def test_round_trip_through_pmtiles(tmp_path: Path) -> None:
    path = tmp_path / "sample.pmtiles"
    _write_sample(path)

    with path.open("rb") as f:
        reader = Reader(MmapSource(f))
        header = reader.header()
        assert header["tile_type"] == TileType.MVT
        assert header["tile_compression"] == Compression.GZIP
        assert (header["min_zoom"], header["max_zoom"]) == (ZOOM, ZOOM)
        assert reader.metadata() == {"name": "test"}
        assert reader.get(ZOOM, 0, 0) is None  # empty tiles are not stored
        data = reader.get(ZOOM, 32, 22)

    decoded = mapbox_vector_tile.decode(gzip.decompress(data), default_options={"y_coord_down": True})
    features = {f["properties"]["code"]: f for f in decoded["communes"]["features"]}
    assert set(features) == set(POLYGONS)
    assert features["2A004"]["id"] == 201004
    assert features["01001"]["properties"] == {"code": "01001", "p_all": 3000, "c_all": 3}

    ring = features["75101"]["geometry"]["coordinates"][0]
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    minx, _miny, maxx, maxy = tile_bounds(ZOOM, 32, 22)
    expected = to_web_mercator([POLYGONS["75101"]])[0].bounds
    scale = EXTENT / (maxx - minx)
    assert abs(min(xs) - (expected[0] - minx) * scale) <= 1
    assert abs(max(ys) - (maxy - expected[1]) * scale) <= 1


def test_indicator_properties_round_trip(tmp_path: Path) -> None:
    indicators = {"sz": 4, "d_hos": 1200, "d_gp": 300, "d_sch": 100, "d_sup": 2500, "d_bak": 0, "d_pool": 30000}
    (geometry,) = to_web_mercator([box(7.20, 43.65, 7.30, 43.75)])  # Nice
    feature = TileFeature(feature_id("06088"), {"code": "06088", "p_all": 5000} | indicators, geometry)
    tiles = build_tiles([TileLayer("communes", 8, 8, [feature])], workers=1)
    path = tmp_path / "nice.pmtiles"
    write_pmtiles(path, tiles, {"name": "test"}, (7.2, 43.65, 7.3, 43.75), (7.25, 43.7, 8))
    with path.open("rb") as f:
        reader = Reader(MmapSource(f))
        (tile_id,) = tiles
        decoded = mapbox_vector_tile.decode(gzip.decompress(reader.get(*tileid_to_zxy(tile_id))))
    assert decoded["communes"]["features"][0]["properties"] == {"code": "06088", "p_all": 5000} | indicators


def test_commune_smaller_than_a_tile_unit_is_kept_at_low_zoom() -> None:
    # About 300 m wide: under one tile unit at z4 (about 610 m), so grid snapping would erase it.
    tiny = box(2.3500, 48.8500, 2.3540, 48.8530)
    large = box(2.0, 48.5, 2.3, 48.8)
    features = [
        TileFeature(i, {"code": code}, geometry)
        for i, (code, geometry) in enumerate(zip(("tiny", "large"), to_web_mercator([tiny, large])))
    ]
    tiles = build_tiles([TileLayer("communes", 4, 4, features, simplify_units={4: 4.0})], workers=1)
    codes = [
        f["properties"]["code"]
        for data in tiles.values()
        for f in mapbox_vector_tile.decode(gzip.decompress(data))["communes"]["features"]
    ]
    assert sorted(codes) == ["large", "tiny"]


def _decode(tiles: dict[int, bytes]) -> dict[tuple[int, int, int], dict]:
    return {
        tileid_to_zxy(tile_id): mapbox_vector_tile.decode(gzip.decompress(data), default_options={"y_coord_down": True})
        for tile_id, data in tiles.items()
    }


def _centre(z: int, x: int, y: int) -> tuple[float, float]:
    minx, miny, maxx, maxy = tile_bounds(z, x, y)
    return (minx + maxx) / 2, (miny + maxy) / 2


def test_points_keep_their_position_and_properties() -> None:
    cx, cy = _centre(8, 128, 90)
    span = tile_bounds(8, 128, 90)[2] - tile_bounds(8, 128, 90)[0]
    single = TileFeature(1, {"k": "hos", "n": "Hôpital Édouard-Herriot", "c": 3, "a": 1}, Point(cx + span / 4, cy))
    several = TileFeature(2, {"k": "gp"}, MultiPoint([(cx, cy), (cx - span / 4, cy + span / 4)]))
    decoded = _decode(build_tiles([TileLayer("places", 8, 8, [single, several])], workers=1))
    assert set(decoded) == {(8, 128, 90)}
    features = {f["id"]: f for f in decoded[(8, 128, 90)]["places"]["features"]}
    assert features[1]["properties"] == {"k": "hos", "n": "Hôpital Édouard-Herriot", "c": 3, "a": 1}
    assert features[1]["geometry"] == {"type": "Point", "coordinates": [3072, 2048]}
    assert features[2]["geometry"]["type"] == "MultiPoint"
    assert sorted(features[2]["geometry"]["coordinates"]) == [[1024, 1024], [2048, 2048]]


def test_a_feature_is_only_in_tiles_from_its_own_minzoom() -> None:
    cx, cy = _centre(8, 128, 90)
    features = [
        TileFeature(1, {"k": "early"}, Point(cx, cy)),
        TileFeature(2, {"k": "late"}, Point(cx + 1000, cy), minzoom=8),
        TileFeature(3, {"k": "never"}, Point(cx + 2000, cy), minzoom=9),
    ]
    decoded = _decode(build_tiles([TileLayer("places", 6, 8, features)], workers=1))
    kinds_by_zoom = {
        z: sorted(f["properties"]["k"] for (tz, _x, _y), layers in decoded.items() if tz == z for f in layers["places"]["features"])
        for z in (6, 7, 8)
    }
    assert kinds_by_zoom == {6: ["early"], 7: ["early"], 8: ["early", "late"]}


def test_a_point_is_in_the_buffer_of_the_next_tile_but_no_farther() -> None:
    minx, miny, maxx, maxy = tile_bounds(8, 128, 90)
    unit = (maxx - minx) / EXTENT
    middle = (miny + maxy) / 2
    near = TileFeature(1, {"k": "near"}, Point(maxx + 10 * unit, middle))  # 10 units east: in the buffer of 128, owned by 129
    far = TileFeature(2, {"k": "far"}, Point(maxx + 100 * unit, middle))  # beyond the 64-unit buffer
    decoded = _decode(build_tiles([TileLayer("places", 8, 8, [near, far])], workers=1))
    in_tiles = {
        kind: sorted(tile for tile, layers in decoded.items() for f in layers["places"]["features"] if f["properties"]["k"] == kind)
        for kind in ("near", "far")
    }
    assert in_tiles == {"near": [(8, 128, 90), (8, 129, 90)], "far": [(8, 129, 90)]}


def test_a_line_is_clipped_to_the_tile_and_its_buffer() -> None:
    minx, miny, maxx, maxy = tile_bounds(8, 128, 90)
    span = maxx - minx
    middle = (miny + maxy) / 2
    line = TileFeature(1, {"z": 3}, LineString([(minx - span / 2, middle), (maxx + span / 2, middle)]))
    decoded = _decode(build_tiles([TileLayer("seismic", 8, 8, [line])], workers=1))
    assert set(decoded) == {(8, 127, 90), (8, 128, 90), (8, 129, 90)}
    (feature,) = decoded[(8, 128, 90)]["seismic"]["features"]
    assert feature["properties"] == {"z": 3}
    xs = [x for x, _y in feature["geometry"]["coordinates"]]
    assert (min(xs), max(xs)) == (-64, EXTENT + 64)


def test_a_line_is_simplified_by_the_tolerance_of_its_zoom() -> None:
    minx, miny, maxx, maxy = tile_bounds(7, 64, 45)
    unit = (maxx - minx) / EXTENT
    middle = (miny + maxy) / 2
    # a zigzag of 2 units, 100 steps across the tile: kept by the default tolerance (1 unit), straightened by 20 units
    points = [(minx + i * unit * 40, middle + (2 * unit if i % 2 else 0)) for i in range(1, 100)]
    feature = TileFeature(1, {"z": 2}, LineString(points))

    def vertices(simplify_units: dict[int, float]) -> int:
        decoded = _decode(build_tiles([TileLayer("seismic", 7, 7, [feature], simplify_units)], workers=1))
        (kept,) = decoded[(7, 64, 45)]["seismic"]["features"]
        return len(kept["geometry"]["coordinates"])

    assert vertices({}) >= 90
    assert vertices({7: 20.0}) <= 3


def test_a_line_snapped_to_a_point_is_dropped() -> None:
    cx, cy = _centre(8, 128, 90)
    unit = (tile_bounds(8, 128, 90)[2] - tile_bounds(8, 128, 90)[0]) / EXTENT
    stub = TileFeature(1, {"z": 2}, LineString([(cx, cy), (cx + 0.1 * unit, cy)]))
    assert build_tiles([TileLayer("seismic", 8, 8, [stub])], workers=1) == {}


def test_points_lines_and_polygons_share_one_archive(tmp_path: Path) -> None:
    (polygon,) = to_web_mercator([box(2.30, 48.80, 2.40, 48.90)])
    (point,) = to_web_mercator([Point(2.35, 48.85)])
    (line,) = to_web_mercator([LineString([(2.30, 48.82), (2.40, 48.88)])])
    layers = [
        TileLayer("communes", 6, 6, [TileFeature(1, {"code": "75101"}, polygon)]),
        TileLayer("places", 6, 6, [TileFeature(1, {"k": "hos"}, point)]),
        TileLayer("seismic", 6, 6, [TileFeature(1, {"z": 2}, line)]),
    ]
    decoded = _decode(build_tiles(layers, workers=1))
    kinds = {name: {f["geometry"]["type"] for f in layer["features"]} for name, layer in decoded[(6, 32, 22)].items()}
    assert kinds == {"communes": {"Polygon"}, "places": {"Point"}, "seismic": {"LineString"}}
