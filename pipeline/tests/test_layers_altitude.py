import math
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import box

from settling.layers import altitude
from settling.layers.altitude import Summary, Throttle, Tile
from settling.sources import SourceError

DAY = "2026-11-06"
RES = altitude.RASTER_RES_M
SEA_WEST_OF_X = 700_000  # the fake raster has no value west of this Lambert-93 easting


class FakeResponse:
    def __init__(self, status_code: int = 200, content_type: str = "application/json", payload=None, content=b""):
        self.status_code = status_code
        self.headers = {"Content-Type": content_type}
        self.payload = payload
        self.content = content

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self.payload


def fake_z_at_northing(y: np.ndarray) -> np.ndarray:
    """Fake terrain: 1 m per 100 m of northing above 6,490,000 (100 m at 6,500,000, 1,100 m at 6,600,000)."""
    return (y - 6_490_000) / 100


class FakeGeoplateforme:
    """Altimetry API: z = latitude * 100, -99999 west of lon 0. WMS: z = fake_z_at_northing, sea in the west."""

    def __init__(self, failures: list[int] | None = None, wms_content_type: str = "image/x-bil;bits=32") -> None:
        self.point_batches: list[int] = []
        self.tiles: list[tuple[str, int, int]] = []
        self.failures = list(failures or [])
        self.wms_content_type = wms_content_type

    def post(self, url: str, json: dict, timeout: int) -> FakeResponse:
        assert url == altitude.ALTI_API and json["resource"] == altitude.ALTI_RESOURCE and json["zonly"] == "true"
        if self.failures:
            return FakeResponse(status_code=self.failures.pop(0))
        lons = [float(v) for v in json["lon"].split("|")]
        lats = [float(v) for v in json["lat"].split("|")]
        self.point_batches.append(len(lons))
        return FakeResponse(payload={"elevations": [-99999.0 if lon < 0 else lat * 100 for lon, lat in zip(lons, lats)]})

    def get(self, url: str, params: dict, timeout: int) -> FakeResponse:
        assert url == altitude.WMS_URL and params["CRS"] == "EPSG:2154" and params["FORMAT"] == altitude.WMS_FORMAT
        minx, miny, maxx, maxy = (float(v) for v in params["BBOX"].split(","))
        width, height = params["WIDTH"], params["HEIGHT"]
        self.tiles.append((params["BBOX"], width, height))
        xs = minx + (np.arange(width) + 0.5) * (maxx - minx) / width
        ys = maxy - (np.arange(height) + 0.5) * (maxy - miny) / height  # row 0 at the top
        gx, gy = np.meshgrid(xs, ys)
        z = np.where(gx < SEA_WEST_OF_X, -99999.0, fake_z_at_northing(gy)).astype("<f4")
        return FakeResponse(content_type=self.wms_content_type, content=z.tobytes())


def _no_sleep(seconds: float) -> None:
    pass


def _throttle() -> Throttle:
    return Throttle(0.0, _no_sleep, lambda: 0.0)


# --- altitude at points -------------------------------------------------------------------------------------


def test_points_are_queried_twenty_at_a_time_in_order_and_nodata_becomes_nan() -> None:
    api = FakeGeoplateforme()
    rng = np.random.default_rng(1)
    lonlat = np.column_stack((rng.uniform(0.5, 7.0, 105), rng.uniform(43.0, 48.9, 105)))
    lonlat[-1] = (-3.0, 47.0)  # the 'sea'
    z = altitude.query_elevations(api, lonlat, sleep=_no_sleep, workers=3)
    assert sorted(api.point_batches) == [5, 20, 20, 20, 20, 20]
    assert np.allclose(z[:-1], np.round(lonlat[:-1, 1], 6) * 100)
    assert math.isnan(z[-1])


def test_implausible_values_become_nan() -> None:
    z = altitude.query_elevations(FakeGeoplateforme(), np.array([[2.0, 60.0], [2.0, 30.0]]), sleep=_no_sleep)
    assert math.isnan(z[0]) and z[1] == 3000.0  # 6000 m does not exist in France


def test_requests_are_spaced_to_the_documented_rate() -> None:
    now = [0.0]
    waits: list[float] = []

    def sleep(seconds: float) -> None:
        waits.append(seconds)
        now[0] += seconds

    altitude.query_elevations(FakeGeoplateforme(), np.full((50, 2), 2.0), sleep=sleep, clock=lambda: now[0], workers=1)
    assert waits == [altitude.MIN_REQUEST_INTERVAL_S] * 2


def test_server_errors_and_rate_limits_are_retried_then_raised() -> None:
    api = FakeGeoplateforme(failures=[429, 503])
    assert altitude.query_elevations(api, np.array([[2.0, 45.0]]), sleep=_no_sleep)[0] == 4500.0
    always_failing = FakeGeoplateforme(failures=[503] * (len(altitude.RETRY_DELAYS_S) + 1))
    with pytest.raises(RuntimeError, match="503"):
        altitude.query_elevations(always_failing, np.array([[2.0, 45.0]]), sleep=_no_sleep)


def test_a_proxy_page_is_a_source_error_naming_the_override() -> None:
    with pytest.raises(SourceError, match="--layer-file altitude"):
        altitude._expect(FakeResponse(status_code=403, content_type="text/html"), "application/json", "u")


# --- relief from the raster ---------------------------------------------------------------------------------


def test_tiles_are_aligned_on_the_raster_grid_and_cover_the_bounds() -> None:
    tiles = altitude.tiles_covering((1010.0, 2010.0, 1010.0 + 260 * RES, 2010.0 + 110 * RES), tile_px=100)
    assert [(t.width, t.height) for t in tiles] == [(100, 100), (100, 100), (61, 100), (100, 11), (100, 11), (61, 11)]
    assert all(t.left % RES == 0 and t.top % RES == 0 for t in tiles)
    minx, miny = min(t.bbox[0] for t in tiles), min(t.bbox[1] for t in tiles)
    maxx, maxy = max(t.bbox[2] for t in tiles), max(t.bbox[3] for t in tiles)
    assert minx <= 1010 and miny <= 2010 and maxx >= 1010 + 260 * RES and maxy >= 2010 + 110 * RES


def test_tile_values_are_read_top_row_first_and_sea_becomes_nan() -> None:
    tile = Tile(left=SEA_WEST_OF_X - 2 * RES, top=6_600_000, width=4, height=3)
    z = altitude.fetch_tile(FakeGeoplateforme(), tile, _throttle())
    assert z.shape == (3, 4)
    assert np.isnan(z[:, :2]).all()
    assert z[0, 2] == pytest.approx(fake_z_at_northing(6_600_000 - RES / 2))
    assert z[2, 3] == pytest.approx(fake_z_at_northing(6_600_000 - 2.5 * RES))


def test_a_wms_error_document_or_a_short_raster_is_a_source_error() -> None:
    tile = Tile(left=800_000, top=6_600_000, width=4, height=3)
    with pytest.raises(SourceError, match="expected image/x-bil"):
        altitude.fetch_tile(FakeGeoplateforme(wms_content_type="text/xml"), tile, _throttle())

    class Short(FakeGeoplateforme):
        def get(self, url: str, params: dict, timeout: int) -> FakeResponse:
            response = super().get(url, params, timeout)
            response.content = response.content[:-4]
            return response

    with pytest.raises(SourceError, match="expected 48 bytes"):
        altitude.fetch_tile(Short(), tile, _throttle())


def test_a_transient_wms_400_is_retried_but_an_api_400_is_not() -> None:
    class Flaky(FakeGeoplateforme):
        def get(self, url: str, params: dict, timeout: int) -> FakeResponse:
            if not self.tiles and self.failures:
                return FakeResponse(status_code=self.failures.pop(0), content_type="text/xml")
            return super().get(url, params, timeout)

    tile = Tile(left=800_000, top=6_600_000, width=4, height=3)
    assert altitude.fetch_tile(Flaky(failures=[400]), tile, _throttle(), sleep=_no_sleep).shape == (3, 4)
    with pytest.raises(RuntimeError, match="400"):
        altitude.query_elevations(FakeGeoplateforme(failures=[400]), np.array([[2.0, 45.0]]), sleep=_no_sleep)


def test_relief_combines_the_tiles_a_commune_overlaps() -> None:
    polygon = box(800_000, 6_600_000, 801_000, 6_602_000)  # 40 x 80 pixels, crossing two tiles
    ranges = altitude.RangeAccumulator([polygon])
    for tile in altitude.tiles_covering(polygon.bounds, tile_px=50):
        ranges.add(tile, altitude.fetch_tile(FakeGeoplateforme(), tile, _throttle()))
    assert ranges.count[0] == 40 * 80
    assert ranges.low[0] == pytest.approx(fake_z_at_northing(6_600_000 + RES / 2))
    assert ranges.high[0] == pytest.approx(fake_z_at_northing(6_602_000 - RES / 2))


def test_pixels_without_value_are_not_counted() -> None:
    coast = box(SEA_WEST_OF_X - 500, 6_600_000, SEA_WEST_OF_X + 500, 6_600_500)  # half at sea
    ranges = altitude.RangeAccumulator([coast])
    tile = altitude.tiles_covering(coast.bounds)[0]
    ranges.add(tile, altitude.fetch_tile(FakeGeoplateforme(), tile, _throttle()))
    assert ranges.count[0] == 20 * 20


# --- one department -----------------------------------------------------------------------------------------


def _commune_l93(x: float, y: float, size: float = 2000.0):
    """A square commune given in WGS84 like the boundaries, built from Lambert-93 corners."""
    corners = altitude.l93_to_lonlat(np.array([[x, y], [x + size, y + size]]))
    return box(corners[0, 0], corners[0, 1], corners[1, 0], corners[1, 1])


def test_measure_uses_the_chef_lieu_then_the_inner_point_and_the_raster_for_relief() -> None:
    codes = ["69001", "69002", "69003", "29001"]
    geometries = [_commune_l93(800_000, 6_500_000), _commune_l93(810_000, 6_500_000), _commune_l93(820_000, 6_500_000),
                  _commune_l93(SEA_WEST_OF_X - 50_000, 6_500_000)]
    inner = np.array([[801_000, 6_501_000], [811_000, 6_501_000], [821_000, 6_501_000], [651_000, 6_501_000]], float)
    chef_lieux = {"69001": (4.85, 45.75), "69003": (-3.0, 47.0)}  # 69003's point is 'at sea'
    api = FakeGeoplateforme()
    first, second, third, sea = altitude.measure(api, codes, geometries, chef_lieux, inner, DAY)
    assert (first.alt_from, first.z_alt) == ("chef_lieu", pytest.approx(4575.0))
    inner_lat = altitude.l93_to_lonlat(inner)[:, 1]
    assert (second.alt_from, second.z_alt) == ("inner_point", pytest.approx(inner_lat[1] * 100, abs=0.01))
    assert (third.alt_from, third.z_alt) == ("inner_point", pytest.approx(inner_lat[2] * 100, abs=0.01))
    assert api.point_batches == [4, 1]  # one pass, then the fallback for the chef-lieu without value
    # the squares are 2 km high: 20 m of fake relief, read at the centres of 25 m pixels
    assert 19.5 <= first.z_max - first.z_min <= 20 and first.pixels > 5000
    assert (sea.z_min, sea.z_max, sea.pixels) == (None, None, 0)


def test_properties_are_integers_and_unknown_values_are_absent() -> None:
    summaries = {
        "01001": Summary("01001", "chef_lieu", 180.6, 99.6, 250.4, 5000, DAY),
        "01002": Summary("01002", None, None, None, None, 0, DAY),
        "01003": Summary("01003", "inner_point", -2.4, None, None, 3, DAY),
    }
    properties = altitude.to_properties(["01001", "01002", "01003", "01004"], summaries)
    assert properties == {"01001": {"alt": 181, "rel": 150}, "01003": {"alt": -2}}
    assert all(isinstance(v, int) for p in properties.values() for v in p.values())


def test_summary_csv_round_trip(tmp_path: Path) -> None:
    summaries = [
        Summary("23096", "chef_lieu", 436.27, 340.0, 686.5, 39000, DAY),
        Summary("55050", "inner_point", 251.0, None, None, 5, DAY),
        Summary("00000", None, None, None, None, 0, DAY),
    ]
    path = tmp_path / "23.csv"
    altitude.write_summaries(path, summaries)
    assert path.read_text(encoding="utf-8").splitlines()[0] == ",".join(altitude.CSV_COLUMNS)
    assert altitude.read_summaries(path) == {s.code: s for s in summaries}


def test_a_csv_without_the_expected_columns_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "bad.csv"
    path.write_text("code_insee,alt\n01001,200\n", encoding="utf-8")
    with pytest.raises(SourceError, match="missing columns"):
        altitude.read_summaries(path)


# --- gate ---------------------------------------------------------------------------------------------------


def test_gate_checks_only_communes_in_the_build() -> None:
    assert altitude.gate({"69382": {"alt": 168, "rel": 12}}) == []
    assert altitude.gate({"74056": {"alt": 1036, "rel": 3500}, "75104": {"alt": 120, "rel": 5}}) == [
        "Paris 4e (75104) alt=120, expected 25..50"
    ]
    assert altitude.gate({"59183": {"alt": 3}}) == ["Dunkerque (59183) has no rel"]


def test_layer_is_discovered_with_ranges_and_coverage_for_each_field() -> None:
    from settling import layers

    assert "altitude" in [layer.name for layer in layers.discover()]
    assert set(altitude.LAYER.ranges) == set(altitude.LAYER.fields) == set(altitude.LAYER.min_coverage)
