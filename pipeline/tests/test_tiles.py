import gzip
from pathlib import Path

import mapbox_vector_tile
from pmtiles.reader import MmapSource, Reader
from pmtiles.tile import Compression, TileType, tileid_to_zxy
from shapely.geometry import box

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
