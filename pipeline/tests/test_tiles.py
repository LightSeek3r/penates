import gzip
from pathlib import Path

import mapbox_vector_tile
from pmtiles.reader import MmapSource, Reader
from pmtiles.tile import Compression, TileType
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
