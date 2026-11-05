from pathlib import Path

import pytest
from shapely.geometry import box

from settling import seismic
from settling.boundaries import Area
from settling.sources import SEISMIC_CODES_PER_REQUEST, _query_seismic_api

SOURCE = {"06088": 4, "75101": 1, "69123": 2, "13055": 2, "01002": 2, "01003": 3}
# 01002 and 01003 merged into the commune nouvelle 01001, absent from the API's COG year.
MERGED = {"01002": "01001", "01003": "01001"}


def test_zones_join_by_own_code_then_plm_parent_then_former_communes() -> None:
    codes = ["06088", "75101", "69381", "13201", "01001", "01999"]
    zones, report = seismic.assign_zones(codes, SOURCE, MERGED)
    assert zones == {"06088": 4, "75101": 1, "69381": 2, "13201": 2, "01001": 3}
    assert report.by_method == {"former_communes": 1, "own_code": 2, "plm_parent": 2}
    assert report.from_former_communes == [{"code": "01001", "zone": 3, "former": {"01002": 2, "01003": 3}}]
    assert report.missing == ["01999"]


@pytest.mark.parametrize(
    ("code", "parent"), [("75106", "75056"), ("69383", "69123"), ("13216", "13055"), ("75056", None), ("69123", None),
                         ("13001", None), ("69381", "69123")],
)
def test_plm_parent(code: str, parent: str | None) -> None:
    assert seismic.plm_parent(code) == parent


def test_one_query_covers_parents_and_former_communes() -> None:
    assert seismic.codes_to_query(["75101", "01001", "06088"], MERGED) == ["01001", "01002", "01003", "06088", "75056",
                                                                            "75101"]


def test_unresolved_commune_takes_the_highest_touching_zone_and_islands_the_nearest() -> None:
    communes = [
        Area("01001", "A", "01", box(0, 0, 1, 1)),
        Area("01002", "B", "01", box(1, 0, 2, 1)),
        Area("01003", "Restored", "01", box(0, 1, 2, 2)),  # touches A and B
        Area("01004", "Island", "01", box(5, 5, 6, 6)),
    ]
    zones, report = seismic.assign_zones([a.code for a in communes], {"01001": 2, "01002": 3}, {})
    zones, report = seismic.fill_from_neighbours(zones, report, communes)
    assert zones["01003"] == 3
    assert zones["01004"] == 3  # nearest commune is the restored one, already resolved
    assert report.by_method["neighbours"] == 2
    assert report.missing == []


@pytest.mark.parametrize(("raw", "zone"), [("4", 4), ("4 - MOYENNE", 4), ("1", 1), ("", None), ("9", None), (None, None)])
def test_parse_zone(raw: object, zone: int | None) -> None:
    assert seismic.parse_zone(raw) == zone


def test_zone_csv_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "zones.csv"
    seismic.write_zone_csv(path, {"75101": 1, "06088": 4})
    assert path.read_text(encoding="utf-8").splitlines()[0] == "code_insee,code_zone"
    assert seismic.read_zone_csv(path) == {"06088": 4, "75101": 1}


class FakeResponse:
    status_code = 200
    headers = {"Content-Type": "application/json"}

    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return self.payload


class FakeApi:
    def __init__(self) -> None:
        self.batches: list[list[str]] = []

    def get(self, url: str, params: dict, timeout: int) -> FakeResponse:
        codes = params["code_insee"].split(",")
        self.batches.append(codes)
        rows = [{"code_insee": c, "code_zone": "2", "zone_sismicite": "2 - FAIBLE"} for c in codes if c != "00000"]
        rows.append({"code_insee": None, "code_zone": "1"})  # seen live for 75056
        return FakeResponse({"results": len(rows), "page": 1, "total_pages": 1, "data": rows})


def test_api_is_queried_in_batches_of_twenty_and_rows_without_code_are_ignored() -> None:
    api = FakeApi()
    codes = [f"{n:05d}" for n in range(45)]
    zones = _query_seismic_api(api, codes)
    assert [len(b) for b in api.batches] == [SEISMIC_CODES_PER_REQUEST, SEISMIC_CODES_PER_REQUEST, 5]
    assert len(zones) == 44
    assert "00000" not in zones
