import math
from pathlib import Path

import numpy as np
import pytest
import requests
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

    m = altitude.TILE_MARGIN_PX
    with pytest.raises(SourceError, match=f"expected {(4 + 2 * m) * (3 + 2 * m) * 4} bytes"):
        altitude.fetch_tile(Short(), tile, _throttle())


@pytest.mark.parametrize(
    "error",
    [
        requests.exceptions.ChunkedEncodingError("IncompleteRead"),
        requests.exceptions.ReadTimeout("read timed out"),
        requests.exceptions.ConnectionError("reset"),
    ],
    ids=lambda error: type(error).__name__,
)
def test_a_cut_or_timed_out_download_is_retried_then_raised(error: Exception) -> None:
    class Dropping(FakeGeoplateforme):
        def __init__(self, drops: int) -> None:
            super().__init__()
            self.drops = drops

        def get(self, url: str, params: dict, timeout: int) -> FakeResponse:
            if self.drops:
                self.drops -= 1
                raise error
            return super().get(url, params, timeout)

    tile = Tile(left=800_000, top=6_600_000, width=4, height=3)
    assert altitude.fetch_tile(Dropping(drops=2), tile, _throttle(), sleep=_no_sleep).shape == (3, 4)
    with pytest.raises(type(error)):
        altitude.fetch_tile(Dropping(drops=len(altitude.RETRY_DELAYS_S) + 1), tile, _throttle(), sleep=_no_sleep)


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


# Raw WMS values read on 2026-11-09; "truth" is the altimetry API at the pixel centres.
GAP = -99999.0


def _masked_away(raw: np.ndarray, masked: np.ndarray) -> np.ndarray:
    """Pixels with a plausible value that the mask dropped."""
    return ~np.isnan(altitude._plausible(raw)) & np.isnan(masked)


def test_a_contaminated_coastline_twice_as_thick_is_masked_and_the_flat_shore_kept() -> None:
    # Talais (33521), Gironde estuary: shore at -1 m (API -1.2 at the -93.2 pixels)
    coast = np.array([
        [-0.9, -507.5, -52355.0, -99895.1, GAP, GAP, GAP],
        [-0.9, -0.9, -52.9, -49459.0, -99942.5, GAP, GAP],
        [-0.9, -1.0, -1.0, -93.2, -99942.5, GAP, GAP],
        [-1.0, -1.0, -1.0, -93.2, -65218.9, GAP, GAP],
        [-1.1, -1.2, -1.2, -1.2, -13394.2, -97949.2, GAP],
        [-1.0, -1.1, -1.1, -1.2, -13394.2, -97949.2, GAP],
        [-1.0, -1.1, -1.2, -1.2, -1.2, -57632.0, GAP],
    ])
    raw = np.pad(coast, ((2, 2), (6, 0)), mode="edge")  # more of the same shore inland
    masked = altitude.mask_gap_contamination(raw)
    assert np.nanmin(masked) == pytest.approx(-1.2)
    dropped = raw[_masked_away(raw, masked)]
    assert sorted(dropped.tolist()) == [-93.2, -93.2, -52.9]


def test_a_contaminated_seam_ramping_down_across_fields_is_masked() -> None:
    # Bannay (18020): one row of the model's seam blends a gap into 144 m fields (API 144 m all along)
    raw = np.full((9, 14), 144.5) + np.add.outer(np.arange(9), np.arange(14)) * 0.05
    raw[4] = [144.5, 144.5, 144.5, 111.0, 93.6, 59.5, 25.7, -7.9, -41.7, -75.7, -109.2, -142.7, -176.1, -209.5]
    masked = altitude.mask_gap_contamination(raw)
    assert np.nanmin(masked) == pytest.approx(144.5)
    assert np.isnan(masked[4, 3:]).all() and _masked_away(raw, masked).sum() == 7


def test_a_hole_inside_valid_ground_is_masked_but_the_shore_below_is_kept() -> None:
    # Roscanvel (29238): a 2 x 2 px hole on a 63 m plateau (API 64 m), real shore at 0 m to the west
    raw = np.array([
        [0.1, 1.4, 10.0, 30.4, 45.6, 60.7, 63.5, 64.2, 65.2],
        [16.4, 21.9, 27.2, 36.4, 45.6, 59.9, 66.2, 64.2, 65.2],
        [44.1, 21.9, 27.2, 36.4, 45.6, 59.9, 66.2, 67.5, 64.0],
        [51.0, 51.0, 51.0, 52.9, 56.3, 61.9, 64.3, 65.9, 64.6],
        [57.6, 59.7, 62.0, 63.3, -13.0, 1.0, 64.3, 65.9, 64.6],
        [15.8, 59.7, 62.0, 63.3, -13.0, 1.0, 64.5, 65.3, 65.8],
        [15.8, 34.6, 56.3, 61.7, 7.2, 7.1, 63.5, 65.4, 66.2],
        [-0.1, 2.2, 23.7, 54.1, 60.9, 63.2, 63.5, 65.4, 66.2],
        [-0.1, 2.2, 23.7, 54.1, 60.9, 63.2, 63.9, 64.8, 66.3],
    ])
    masked = altitude.mask_gap_contamination(raw)
    hole = np.zeros(raw.shape, dtype=bool)
    hole[4:7, 4:6] = True
    assert np.array_equal(_masked_away(raw, masked), hole)
    assert np.nanmin(masked) == pytest.approx(-0.1)


def test_a_rocky_shore_below_the_shore_floor_and_contaminated_narrow_strips_are_masked() -> None:
    # Piana (2A212): -34 m on a steep coast (API 0 to 1 m), too rough for the surface test alone
    piana = np.array([
        [GAP, GAP, GAP, -73628.7, -3634.5, -16178.9, 9.0, 9.0, 46.3],
        [GAP, GAP, GAP, -64663.6, -34.0, 21.1, 21.1, 35.0, 73.7],
        [GAP, GAP, GAP, -64663.6, -34.0, 21.1, 21.1, 35.0, 73.7],
        [-99924.1, -80139.9, -35592.7, -730.4, 28.8, 28.8, 46.3, 64.4, 81.7],
        [-99924.1, -80139.9, -35592.7, 41.6, 58.8, 58.8, 70.6, 86.0, 114.9],
    ])
    assert np.nanmin(altitude.mask_gap_contamination(piana)) == pytest.approx(9.0)
    # Saint-Jouin-Bruneval (76595): a breakwater 1 px wide at 8 to 10 m, one pixel reading -89.8
    jetty = np.full((7, 7), GAP)
    for i, z in enumerate([9.1, 8.4, -89.8, 9.3, 8.1, 8.7, 9.5]):
        jetty[i, 6 - i] = z
    masked = altitude.mask_gap_contamination(jetty)
    assert np.isnan(masked[2, 4]) and np.nanmin(masked) == pytest.approx(8.1)
    # too narrow for a plane, above the shore floor: an islet 1 px wide at 25 m, one pixel 22 m low
    islet = np.full((5, 9), GAP)
    islet[2, 2:7] = [25.0, 24.0, 3.0, 24.5, 25.5]
    assert np.nanmin(altitude.mask_gap_contamination(islet)) == 24.0
    assert np.isnan(altitude.mask_gap_contamination(np.pad([[5.0]], 2, constant_values=GAP))).all()


def test_a_resampled_copy_of_a_rejected_shore_pixel_is_masked_too() -> None:
    # Saint-Valery-en-Caux (76655): -20 m twice on a 0 m shore under a cliff (API -2 m); the lower copy
    # is not next to a certain gap and the cliff leaves no clean plane, only its value betrays it
    raw = np.array([
        [GAP] * 13,
        [-83369.9, -82999.8, -84632.6, -87088.4, -89100.5, GAP, GAP, GAP, GAP, GAP, GAP, GAP, GAP],
        [-83369.9, -82999.8, -84632.6, -87088.4, -89100.5, -91754.0, -93385.6, -95600.1, -97173.3, -98397.6,
         -89565.6, -69995.2, -50334.8],
        [0.4, 0.4, 0.2, 0.0, -0.2, -0.3, -20.0, -263.8, -899.9, -1839.1, -172.7, -0.1, -0.0],
        [1.4, 1.4, 1.3, 0.0, -0.2, -0.3, -20.0, -263.8, -899.9, -1839.1, -172.7, -0.1, -0.0],
        [1.4, 1.4, 1.3, 1.0, 0.5, 0.2, 0.5, 0.4, 0.4, 0.7, 1.0, 1.1, 1.5],
        [6.6, 5.0, 4.2, 3.8, 3.4, 3.2, 3.3, 3.7, 4.5, 10.4, 27.1, 37.0, 43.1],
        [69.9, 5.0, 4.2, 3.8, 3.4, 3.2, 3.3, 3.7, 4.5, 10.4, 27.1, 37.0, 43.1],
        [69.9, 69.0, 65.9, 58.7, 56.0, 55.2, 56.7, 61.8, 55.1, 64.4, 69.2, 68.7, 68.2],
    ], dtype="<f4")  # float32 as the WMS sends it: copies are bit-identical
    masked = altitude.mask_gap_contamination(raw)
    assert np.isnan(masked[3:5, 6]).all()
    assert np.nanmin(masked) == pytest.approx(-0.3)


def test_flat_ground_equal_to_its_neighbours_is_kept_and_copies_do_not_chain() -> None:
    foreshore = np.vstack([np.full((2, 10), GAP), np.full((8, 10), -4.5)]).astype("<f4")  # Paimpol: flat at -4.5 m
    assert not np.isnan(altitude.mask_gap_contamination(foreshore)[2:]).any()
    # a flat basin floor at -12 m: the row next to the sea falls below the shore floor, its copies with it,
    # but copies of copies are not taken, so the rest of the flat stays
    dock = np.vstack([np.full((2, 10), GAP), np.full((8, 10), -12.0)]).astype("<f4")
    masked = altitude.mask_gap_contamination(dock)
    assert np.isnan(masked[2:4]).all() and not np.isnan(masked[4:]).any()


def test_steep_real_terrain_and_deep_quarries_are_kept() -> None:
    cliff = np.repeat([[400.0], [400.0], [250.0], [100.0], [100.0]], 6, axis=1)  # 300 m in 50 m, inland
    assert np.array_equal(altitude.mask_gap_contamination(cliff), cliff)
    shore = np.where(np.arange(12) < 3, GAP, (np.arange(12) - 3) * 8.0) * np.ones((9, 1))  # 8 m per pixel into the sea
    assert np.nanmin(altitude.mask_gap_contamination(shore)) == 0.0
    distance = np.hypot(*np.mgrid[-14:15, -14:15])
    quarry = np.clip(-79.0 + 20.0 * (distance - 3), -79.0, 40.0)  # Gorges (44064): pit floor at -79 m
    assert np.array_equal(altitude.mask_gap_contamination(quarry), quarry)
    # Bouguenais (44020): a floor at -118 m reads as no value, its walls next to it must stay
    deeper = np.clip(-118.0 + 20.0 * (distance - 3), -118.0, 40.0)
    masked = altitude.mask_gap_contamination(deeper)
    assert np.nanmin(masked) == pytest.approx(-98.0) and _masked_away(deeper, masked).sum() <= 4


def test_a_tile_sees_the_gap_beyond_its_edge() -> None:
    class ContaminatedShore(FakeGeoplateforme):
        """Contamination two pixels thick east of the sea, as along real coasts."""

        def get(self, url: str, params: dict, timeout: int) -> FakeResponse:
            response = super().get(url, params, timeout)
            minx, _, maxx, _ = (float(v) for v in params["BBOX"].split(","))
            xs = minx + (np.arange(params["WIDTH"]) + 0.5) * (maxx - minx) / params["WIDTH"]
            z = np.frombuffer(response.content, dtype="<f4").reshape(params["HEIGHT"], params["WIDTH"]).copy()
            z[:, (xs > SEA_WEST_OF_X) & (xs < SEA_WEST_OF_X + 2 * RES)] = -60.0
            response.content = z.tobytes()
            return response

    # the sea and the first contaminated column are west of the tile: a 1 px margin would see no gap
    tile = Tile(left=SEA_WEST_OF_X + RES, top=6_600_000, width=5, height=4)
    z = altitude.fetch_tile(ContaminatedShore(), tile, _throttle())
    assert np.isnan(z[:, 0]).all() and not np.isnan(z[:, 1:]).any()


def test_tiles_are_fetched_with_a_margin() -> None:
    api = FakeGeoplateforme()
    altitude.fetch_tile(api, Tile(left=800_000, top=6_600_000, width=4, height=3), _throttle())
    m = altitude.TILE_MARGIN_PX
    bbox = f"{800_000 - m * RES},{6_600_000 - (3 + m) * RES},{800_000 + (4 + m) * RES},{6_600_000 + m * RES}"
    assert api.tiles == [(bbox, 4 + 2 * m, 3 + 2 * m)]


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


# --- committed table ----------------------------------------------------------------------------------------

META = {"source": "IGN RGE ALTI", "boundaries": "ADMIN-EXPRESS-COG-CARTO-PE_4-0__GEOPARQUET_WGS84G_FRA_2026-01-01",
        "queried_on": DAY}
TABLE_ROWS = [
    Summary("23096", "chef_lieu", 455.27, 340.4, 674.6, 39000, DAY),
    Summary("01002", "chef_lieu", 300.0, 280.0, 350.0, 900, DAY),
    Summary("01003", "chef_lieu", 310.0, 290.0, 420.0, 900, DAY),
    Summary("55050", "inner_point", 297.58, None, None, 5, DAY),
]


@pytest.fixture
def table_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(altitude, "TABLE_DIR", tmp_path)
    altitude.write_table(tmp_path / "altitude-2026-01-01.csv", TABLE_ROWS, META)
    return tmp_path


def test_table_is_deterministic_with_its_header_and_round_trips(table_dir: Path, tmp_path: Path) -> None:
    path = altitude.committed_table_path()
    again = tmp_path / "again" / "altitude-2026-01-01.csv"
    altitude.write_table(again, reversed(TABLE_ROWS), META)
    assert path.read_bytes() == again.read_bytes()
    assert path.read_text(encoding="utf-8").splitlines()[:5] == [
        "# source: IGN RGE ALTI",
        f"# boundaries: {META['boundaries']}",
        f"# queried_on: {DAY}",
        "code_insee,z_alt,z_min,z_max,alt_from",
        "01002,300.00,280,350,c",
    ]
    table = altitude.read_table(path)
    assert table.meta == META
    assert table.summaries["23096"] == Summary("23096", "chef_lieu", 455.27, 340.0, 675.0, None, DAY)
    assert table.summaries["55050"] == Summary("55050", "inner_point", 297.58, None, None, None, DAY)


def test_the_newest_committed_table_is_used(table_dir: Path) -> None:
    altitude.write_table(table_dir / "altitude-2027-01-01.csv", TABLE_ROWS[:1], META)
    assert altitude.committed_table_path().name == "altitude-2027-01-01.csv"


def test_chef_lieu_altitudes_come_from_the_table(table_dir: Path) -> None:
    assert altitude.chef_lieu_altitudes() == {"01002": 300.0, "01003": 310.0, "23096": 455.27, "55050": 297.58}


class Context:
    """The parts of LayerContext that compute uses."""

    def __init__(self, codes: list[str], merged_codes: dict[str, str]) -> None:
        self.codes, self.merged_codes, self.overrides = codes, merged_codes, {}


def test_compute_reads_the_table_and_measures_only_missing_communes(
    table_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked: list[list[int]] = []

    def measured(ctx, indices, refresh=False):
        asked.append(indices)
        return {"38999": Summary("38999", "chef_lieu", 1200.4, 1000.0, 1900.0, 300, DAY)}, "edition"

    monkeypatch.setattr(altitude, "measured_by_department", measured)
    result = altitude.compute(Context(["23096", "55050", "38999"], {}))
    assert asked == [[2]]
    assert result.properties == {
        "23096": {"alt": 455, "rel": 335}, "55050": {"alt": 298}, "38999": {"alt": 1200, "rel": 900}
    }
    assert result.report["not_in_table"] == {"api": 1}
    assert result.source["table"] == "altitude-2026-01-01.csv" and result.source["queried_on"] == DAY


def test_a_commune_nouvelle_takes_its_former_communes_relief_when_the_services_fail(
    table_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def failing(ctx, indices, refresh=False):
        raise SourceError("down")

    monkeypatch.setattr(altitude, "measured_by_department", failing)
    result = altitude.compute(Context(["01001", "77777"], {"01002": "01001", "01003": "01001"}))
    assert result.properties == {"01001": {"rel": 140}}  # 280..420 m; no chef-lieu altitude to take
    assert result.report["not_in_table"] == {"former_communes": 1, "none": 1}


def test_former_communes_need_every_one_of_them_with_a_range() -> None:
    summaries = {s.code: s for s in TABLE_ROWS}
    assert altitude.from_former_communes("01001", ["01002", "01003"], summaries).z_max == 420.0
    assert altitude.from_former_communes("01001", ["01002", "01009"], summaries) is None
    assert altitude.from_former_communes("01001", [], summaries) is None


# --- gate ---------------------------------------------------------------------------------------------------


def test_gate_checks_only_communes_in_the_build(table_dir: Path) -> None:
    assert altitude.gate({"23096": {"alt": 455, "rel": 335}}) == []
    assert altitude.gate({"23096": {"alt": 600, "rel": 335}, "01002": {"alt": 300, "rel": 70}}) == [
        "Guéret (23096) alt=600, expected 380..500"
    ]
    assert altitude.gate({"23096": {"rel": 335}}) == ["Guéret (23096) has no alt"]


def test_gate_flags_a_table_of_another_boundaries_edition(table_dir: Path) -> None:
    communes = {code: {} for code in ["23096", "01002", "01003", "55050"]}
    assert altitude.table_problems(communes) == []
    communes["99999"] = {}
    assert "covers 4/5 tile communes" in altitude.table_problems(communes)[0]


def test_gate_without_a_committed_table(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(altitude, "TABLE_DIR", tmp_path)
    assert altitude.table_problems({"23096": {}}) == [f"no committed table in {tmp_path}"]


def test_layer_is_discovered_with_ranges_and_coverage_for_each_field() -> None:
    from settling import layers

    assert "altitude" in [layer.name for layer in layers.discover()]
    assert set(altitude.LAYER.ranges) == set(altitude.LAYER.fields) == set(altitude.LAYER.min_coverage)
