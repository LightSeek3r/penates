import json
import struct
import zipfile
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import requests
from shapely.geometry import box

from settling.boundaries import Area
from settling.layers import LayerContext, check_properties
from settling.layers import georisques as geo
from settling.layers.georisques import Cavity

FIXTURES = Path(__file__).parent / "fixtures" / "georisques"


def gaspar_zip(tmp_path: Path, skip: str | None = None) -> Path:
    """The real GASPAR layout (one CSV per table, dated names) built from verbatim rows of the 2026-11-02 file."""
    path = tmp_path / "gaspar.zip"
    with zipfile.ZipFile(path, "w") as archive:
        for csv_file in sorted((FIXTURES / "gaspar").glob("*.csv")):
            if skip is None or not csv_file.name.startswith(skip):
                archive.write(csv_file, csv_file.name)
    return path


# --- fl --------------------------------------------------------------------------------------------------

def test_flood_class_per_gaspar_code(tmp_path: Path) -> None:
    flood = geo.read_flood_source(gaspar_zip(tmp_path))
    assert flood.edition == "2026-11-02"
    # Paris: approved PPRi (the abrogated first one is ignored), Blyes: prescribed (prorogé) + atlas,
    # Ambronay: atlas only, 01001: flood listed in the DDRM.
    assert flood.classes == {"75056": 3, "01047": 2, "01007": 1, "01001": 1}
    # Listed without any flood record: DDRM without flood, clay PPR only, CatNat only.
    assert {"01002", "04108", "33436"} <= flood.known
    assert "" not in flood.known  # a PPR row without commune code


def test_flood_archive_missing_a_table_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(geo.GeorisquesError, match="azi"):
        geo.read_flood_source(gaspar_zip(tmp_path, skip="azi"))


# --- territory resolution --------------------------------------------------------------------------------

MERGED = {"01002": "01001", "01003": "01001", "01005": "01004"}


def test_merged_commune_takes_the_highest_value_of_its_territory() -> None:
    source = {"01001": 1, "01002": 3, "01005": 2, "75056": 3, "01009": 0}
    result = geo.resolve_territories(["01001", "01004", "75107", "01009", "01999"], source, MERGED)
    assert result.values == {"01001": 3, "01004": 2, "75107": 3, "01009": 0}
    assert result.by_method == {"former_communes": 1, "own_and_former_communes": 1, "own_code": 1, "plm_parent": 1}
    assert result.missing == ["01999"]


def test_own_arrondissement_code_wins_over_the_city() -> None:
    result = geo.resolve_territories(["69389", "69381"], {"69389": 3, "69381": 1, "69123": 3}, {})
    assert result.values == {"69389": 3, "69381": 1}


def test_known_code_without_value_is_neither_a_value_nor_missing() -> None:
    result = geo.resolve_territories(["01001"], {}, {}, known={"01001"})
    assert result.values == {} and result.missing == []


# --- rn --------------------------------------------------------------------------------------------------

def test_radon_categories_from_the_asnr_file() -> None:
    radon = geo.read_radon(FIXTURES / "radon_sample.csv")
    assert radon == {"21377": 1, "25201": 1, "34026": 2, "75101": 1, "69389": 3, "69381": 1, "23096": 3,
                     "02373": 1, "01124": 1}  # the file writes Hary 2373 and Cormoz 1124: leading zero restored


def test_radon_ignores_rows_outside_the_three_categories(tmp_path: Path) -> None:
    path = tmp_path / "radon.csv"
    path.write_text("nom_comm;nom_dept;insee_com;classe_potentiel;reg\nA;X;01001;4;FR\nB;X;01002;;FR\nC;X;;3;FR\n"
                    "D;X;98801;1;NC\nD;X;98801;3;NC\n", encoding="utf-8")
    assert geo.read_radon(path) == {"98801": 3}


# --- cl --------------------------------------------------------------------------------------------------

def clay_zip(path: Path, records: list[tuple[list[list[tuple[float, float]]], int]]) -> Path:
    """A minimal ESRI shapefile (polygon type 5) with a numeric `niveau`, zipped like the BRGM files."""
    shp_records = b""
    for number, (rings, _) in enumerate(records, start=1):
        points = [pt for ring in rings for pt in ring]
        parts = np.cumsum([0] + [len(r) for r in rings[:-1]]).tolist()
        xs, ys = [p[0] for p in points], [p[1] for p in points]
        content = struct.pack("<i4d2i", 5, min(xs), min(ys), max(xs), max(ys), len(rings), len(points))
        content += struct.pack(f"<{len(parts)}i", *parts) + struct.pack(f"<{2 * len(points)}d", *[c for p in points for c in p])
        shp_records += struct.pack(">2i", number, len(content) // 2) + content
    header = struct.pack(">7i", 9994, 0, 0, 0, 0, 0, (100 + len(shp_records)) // 2) + struct.pack("<2i8d", 1000, 5, *[0.0] * 8)
    fields = [("gid", 18), ("niveau", 24)]
    dbf = struct.pack("<4BIHH20x", 3, 125, 11, 28, len(records), 32 + 32 * len(fields) + 1, 1 + sum(s for _, s in fields))
    for name, size in fields:
        dbf += struct.pack("<11sc4xBB14x", name.encode(), b"N", size, 0)
    dbf += b"\r"
    for number, (_, level) in enumerate(records, start=1):
        dbf += b" " + str(number).rjust(18).encode() + f"{level:.15f}".rjust(24).encode()
    dbf += b"\x1a"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("AleaRG_2025_99_L93.shp", header + shp_records)
        archive.writestr("AleaRG_2025_99_L93.dbf", dbf)
    return path


CLOCKWISE_SQUARE = [(0, 0), (0, 10), (10, 10), (10, 0), (0, 0)]
COUNTER_CLOCKWISE_HOLE = [(2, 2), (4, 2), (4, 4), (2, 4), (2, 2)]
SECOND_SHELL = [(20, 0), (20, 5), (25, 5), (25, 0), (20, 0)]


def test_clay_shapefile_reader_keeps_holes_and_parts(tmp_path: Path) -> None:
    path = clay_zip(tmp_path / "clay.zip", [([CLOCKWISE_SQUARE, COUNTER_CLOCKWISE_HOLE, SECOND_SHELL], 3), ([CLOCKWISE_SQUARE], 1)])
    polygons, levels = geo.read_clay_shapefile(path)
    assert levels == [3, 1]
    assert polygons[0].area == pytest.approx(100 - 4 + 25)
    assert polygons[1].area == pytest.approx(100)


def test_clay_shares_split_each_commune_by_level() -> None:
    communes = [box(0, 0, 10, 10), box(10, 0, 20, 10)]
    polygons = [box(0, 0, 3, 10), box(3, 0, 5, 10), box(15, 0, 20, 10)]
    shares = geo.clay_shares(communes, polygons, [3, 1, 2])
    np.testing.assert_allclose(shares, [[0.5, 0.2, 0.0, 0.3], [0.5, 0.0, 0.5, 0.0]])
    assert [geo.clay_class(row) for row in shares] == [3, 2]


@pytest.mark.parametrize(
    ("shares", "level"),
    [([1, 0, 0, 0], 0), ([0.8, 0.1, 0.05, 0.05], 0), ([0.75, 0.25, 0, 0], 1), ([0.7, 0.1, 0.1, 0.1], 1),
     ([0.6, 0, 0.2, 0.2], 2), ([0.5, 0, 0.2, 0.3], 3), ([0.5, 0, 0.3, 0.2], 2), ([0, 0, 0, 1], 3)],
)
def test_clay_class_is_the_level_reached_by_a_quarter_of_the_area(shares: list[float], level: int) -> None:
    assert geo.clay_class(np.asarray(shares)) == level


def test_commune_without_mapped_clay_is_a_priori_nil() -> None:
    assert geo.clay_shares([box(0, 0, 1, 1)], [], []).tolist() == [[1.0, 0.0, 0.0, 0.0]]


# --- cv --------------------------------------------------------------------------------------------------

def test_cavity_rows_with_lambert_ii_coordinates_and_confidential_rows() -> None:
    cavities = geo.read_cavities(FIXTURES / "cavites_69_sample.csv")
    assert [(c.record_id, c.code) for c in cavities] == [("62717", "69008"), ("47038", "69017"), ("73635", "69123")]
    lon, lat = cavities[0].lon, cavities[0].lat
    assert 4.4 < lon < 4.6 and 45.7 < lat < 45.9  # Lambert II étendu -> WGS84, west of Lyon
    assert cavities[2].lon is None  # confidential: no coordinates published


AREAS = [
    Area("69008", "A", "69", box(4.40, 45.70, 4.60, 45.90)),
    Area("69381", "Lyon 1er", "69", box(4.80, 45.75, 4.85, 45.80)),
    Area("69382", "Lyon 2e", "69", box(4.80, 45.70, 4.85, 45.75)),
    Area("13201", "Marseille 1er", "13", box(5.36, 43.29, 5.40, 43.31)),
    Area("13202", "Marseille 2e", "13", box(5.36, 43.31, 5.40, 43.33)),
    Area("75101", "Paris 1er", "75", box(2.33, 48.85, 2.35, 48.87)),
]


def test_cavities_are_attributed_by_code_merger_then_coordinates() -> None:
    cavities = [
        Cavity("1", "69008", None, None),
        Cavity("1", "69008", None, None),  # same record listed twice
        Cavity("2", "69999", None, None),  # former commune merged into 69008
        Cavity("3", "13055", 5.38, 43.32),  # Marseille city code, located in the 2e
        Cavity("4", "69123", None, None),  # confidential Lyon record: no arrondissement can be given
        Cavity("5", "01999", None, None),  # unknown code, no coordinates
        Cavity("6", "75056", 2.34, 48.86),  # department without a published inventory
    ]
    result = geo.count_cavities(cavities, AREAS, {"69999": "69008"}, published={"69", "13"})
    assert result.counts == {"69008": 2, "13201": 0, "13202": 1}
    assert result.by_method == {"coordinates": 2, "former_commune": 1, "own_code": 1}
    assert result.unknown_plm_cities == ["69123"]
    assert result.unattributed == 1


# --- gate ------------------------------------------------------------------------------------------------

def test_gate_flags_spot_check_mismatches_and_values_where_no_source_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(geo, "SPOT_CHECKS", {"rn": {"23096": {3}}})
    communes = {"23096": {"code": "23096", "rn": 1}, "78646": {"code": "78646", "cv": 0}, "75101": {"code": "75101", "cl": 1}}
    problems = geo.gate(communes)
    assert len(problems) == 3
    assert "rn of 23096 is 1" in problems[0] and "cv published" in problems[1] and "Paris" in problems[2]


def test_spot_checks_are_within_the_layer_ranges_and_pass_their_own_gate() -> None:
    communes: dict[str, dict] = {}
    for prop, spots in geo.SPOT_CHECKS.items():
        for code, allowed in spots.items():
            communes.setdefault(code, {"code": code})[prop] = min(allowed)
    assert geo.SPOT_CHECKS
    assert geo.gate(communes) == []
    assert check_properties([replace(geo.LAYER, min_coverage={})], communes) == []


def test_layer_contract() -> None:
    assert geo.LAYER.name == "georisques"
    assert set(geo.LAYER.fields) == set(geo.LAYER.ranges) == set(geo.LAYER.min_coverage) == {"fl", "cl", "rn", "cv"}


# --- compute, offline ------------------------------------------------------------------------------------

GATEWAY_404 = (b'{"message":"no Route matched with those values"}', "application/json; charset=utf-8", 404)


class FakeResponse:
    def __init__(self, body: bytes, content_type: str, status_code: int = 200) -> None:
        self.body = body
        self.headers = {"Content-Type": content_type}
        self.status_code = status_code

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *exc: object) -> None:
        pass

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} Client Error")

    def json(self) -> dict:
        return json.loads(self.body)

    def iter_content(self, size: int):
        yield self.body


class FakeSession:
    """Answers the routes it knows; anything else gets the gateway's 404, as seen live on 2026-11-06."""

    def __init__(self, routes: dict[str, tuple[bytes, str]]) -> None:
        self.routes = routes
        self.requested: list[str] = []

    def get(self, url: str, params: dict | None = None, stream: bool = False, timeout: int = 0, headers: dict | None = None) -> FakeResponse:
        self.requested.append(url)
        return FakeResponse(*self.routes.get(url, GATEWAY_404))


CLAY_LISTED = "https://x/argiles/2025/AleaRG_2025_01_L93.zip"
CAVITIES_LISTED = "https://x/cav/01.csv"
OFFLINE_COMMUNES = [Area("01007", "Ambronay", "01", box(5.0, 45.5, 5.1, 45.6)),
                    Area("01047", "Blyes", "01", box(7.0, 45.5, 7.1, 45.6)),
                    Area("75101", "Paris 1er", "75", box(2.33, 48.85, 2.35, 48.87))]
EXPECTED = {
    "01007": {"fl": 1, "rn": 2, "cl": 2, "cv": 1},
    "01047": {"fl": 2, "cl": 0, "cv": 0},  # outside the clay square; not in the radon sample
    "75101": {"fl": 3, "rn": 1},  # no clay map and no cavity inventory for Paris
}


def offline_routes(tmp_path: Path) -> dict[str, tuple[bytes, str]]:
    # Clay polygons are Lambert-93: this square (x 800-900 km) holds Ambronay (x ~ 860 km), not Blyes (~ 1,016 km).
    clay = clay_zip(tmp_path / "clay.zip", [([[(800_000, 6_400_000), (800_000, 6_800_000), (900_000, 6_800_000),
                                              (900_000, 6_400_000), (800_000, 6_400_000)]], 2)])
    radon = (FIXTURES / "radon_sample.csv").read_text(encoding="utf-8") + "AMBRONAY;AIN;01007;2;FR\n"
    return {
        geo.GASPAR_URL: (gaspar_zip(tmp_path).read_bytes(), "application/zip"),
        geo.RADON_DATASET_API: (json.dumps({"resources": [{"format": "csv", "title": "radon", "url": "https://x/radon.csv",
                                                           "last_modified": "2019-05-06T17:46:00", "checksum": None}]}).encode(), "application/json"),
        "https://x/radon.csv": (radon.encode(), "text/csv"),
        geo.LISTING_URL.format(key=geo.CLAY_KEY): (json.dumps({"departemental": {
            "01 - AIN": {"lien": CLAY_LISTED}, "75 - PARIS": None}}).encode(), "application/json"),
        CLAY_LISTED: (clay.read_bytes(), "application/zip"),
        geo.LISTING_URL.format(key=geo.CAVITY_KEY): (json.dumps({"departemental": {
            "01 - AIN": {"lien": CAVITIES_LISTED}, "75 - PARIS": None}}).encode(), "application/json"),
        CAVITIES_LISTED: (cavity_csv("01007").encode(), "text/csv"),
    }


def cavity_csv(code: str) -> str:
    header = (FIXTURES / "cavites_69_sample.csv").read_text(encoding="utf-8").splitlines()[0]
    return header + "\n" + ";".join(["9"] + [""] * 25 + [code]) + "\n"


def offline_context(tmp_path: Path, routes: dict[str, tuple[bytes, str]]) -> LayerContext:
    return LayerContext(session=FakeSession(routes), raw=tmp_path / "raw", communes=OFFLINE_COMMUNES, merged_codes={},
                        origins=np.zeros((3, 2)))


def test_compute_offline_end_to_end(tmp_path: Path) -> None:
    result = geo.compute(offline_context(tmp_path, offline_routes(tmp_path)))
    assert result.properties == EXPECTED
    assert result.report["rn"]["missing"] == ["01047"]
    assert result.report["cv"]["not_published"] == ["75"]
    assert result.report["cl"]["links"] == result.report["cv"]["links"] == "listing"
    assert set(result.source) == {"fl", "rn", "cl", "cv"} and result.source["fl"]["edition"] == "2026-11-02"


def test_listing_down_falls_back_to_the_pinned_file_urls(tmp_path: Path) -> None:
    routes = offline_routes(tmp_path)
    for key in (geo.CLAY_KEY, geo.CAVITY_KEY):
        del routes[geo.LISTING_URL.format(key=key)]
    routes[geo.CLAY_URL.format(dep="01")] = routes.pop(CLAY_LISTED)
    routes[geo.CAVITY_URL.format(dep="01")] = routes.pop(CAVITIES_LISTED)
    result = geo.compute(offline_context(tmp_path, routes))
    assert result.properties == EXPECTED
    assert result.report["cl"]["links"].startswith("pinned URLs (listing unavailable: 404")
    assert result.source["cl"]["files"]["01"]["url"] == "https://files.georisques.fr/argiles/2025/AleaRG_2025_01_L93.zip"


def test_cavity_export_down_uses_the_newest_earlier_download(tmp_path: Path) -> None:
    routes = offline_routes(tmp_path)
    del routes[CAVITIES_LISTED]
    for day, code in (("2026-11-01", "01047"), ("2026-11-05", "01007")):
        earlier = tmp_path / "raw" / "georisques" / "cavites" / day / "cavites-01.csv"
        earlier.parent.mkdir(parents=True)
        earlier.write_text(cavity_csv(code), encoding="utf-8")
    result = geo.compute(offline_context(tmp_path, routes))
    assert result.properties == EXPECTED
    assert result.report["cv"]["from_earlier_cache"] == {"01": "2026-11-05"}
    assert result.source["cv"]["files"]["01"]["fetched_on"] == "2026-11-05"


def test_cavity_export_down_without_any_cached_copy_is_a_clear_error(tmp_path: Path) -> None:
    routes = offline_routes(tmp_path)
    del routes[CAVITIES_LISTED]
    with pytest.raises(geo.GeorisquesError, match=r"cav/01\.csv: 404 .*No earlier copy is cached"):
        geo.compute(offline_context(tmp_path, routes))


def test_compute_refuses_a_layer_file(tmp_path: Path) -> None:
    ctx = LayerContext(session=FakeSession({}), raw=tmp_path, communes=[], merged_codes={}, origins=np.zeros((0, 2)),
                       overrides={"georisques": tmp_path / "x.zip"})
    with pytest.raises(geo.GeorisquesError, match="no --layer-file"):
        geo.compute(ctx)
