import subprocess
import sys
from pathlib import Path

import pytest
from shapely.geometry import LineString, Point

import check_overlays
from settling.overlays.places import load_kinds
from settling.overlays.risk_lines import RISKS
from settling.tiles import (
    EXTENT, MERCATOR_HALF_WORLD, WORLD, TileFeature, TileLayer, build_tiles, tile_bounds, to_web_mercator, write_pmtiles,
)

CHECK_SCRIPT = Path(check_overlays.__file__)
LYON = (4.83, 45.76)
KINDS = {kind.id: kind for kind in load_kinds()}


def _dot(fid: int, properties: dict, lonlat: tuple[float, float] = LYON, minzoom: int | None = None) -> TileFeature:
    (point,) = to_web_mercator([Point(*lonlat)])
    kind = KINDS.get(properties["k"])
    return TileFeature(fid, properties, point, minzoom if minzoom is not None else kind.minzoom if kind else None)


def _line(fid: int, zone: int) -> TileFeature:
    (line,) = to_web_mercator([LineString([(4.0, 45.0), (4.5, 45.5)])])
    return TileFeature(fid, {"z": zone}, line)


def _risk_line(fid: int, risk: str, level: int, properties: dict | None = None) -> TileFeature:
    (line,) = to_web_mercator([LineString([(4.0, 45.0), (4.5, 45.5)])])
    return TileFeature(fid, properties if properties is not None else {"r": risk, "z": level}, line)


def _lowest_risk_lines() -> list[TileFeature]:
    return [_risk_line(200 + i, risk, definition.levels[0]) for i, (risk, definition) in enumerate(RISKS.items())]


def _archive(
    path: Path, dots: list[TileFeature], lines: list[TileFeature] = (), places_zooms=(5, 12), risk: list[TileFeature] = ()
) -> Path:
    layers = []
    if dots:
        layers.append(TileLayer("places", *places_zooms, dots))
    if lines:
        layers.append(TileLayer("seismic", 3, 10, list(lines)))
    if risk:
        layers.append(TileLayer("risk", 3, 10, list(risk)))
    write_pmtiles(path, build_tiles(layers, workers=1), {"name": "test"}, (-5, 41, 10, 51), (2.5, 46.5, 5))
    return path


@pytest.fixture
def good_dots() -> list[TileFeature]:
    return [
        _dot(1, {"k": "hos", "n": "Hôpital Édouard-Herriot", "a": 1}),
        _dot(2, {"k": "gp", "c": 4}, (4.84, 45.77)),
        _dot(3, {"k": "pri", "n": "École Primaire Publique", "c": 2}, (4.85, 45.78)),
    ]


def test_a_well_formed_department_archive_passes(tmp_path: Path, good_dots: list[TileFeature]) -> None:
    path = _archive(tmp_path / "ok.pmtiles", good_dots, [_line(10, 3)], risk=[_risk_line(11, "flood", 2)])
    assert check_overlays.check(path, national=False) == []


def test_an_archive_with_one_layer_is_a_valid_slice(tmp_path: Path, good_dots: list[TileFeature]) -> None:
    assert check_overlays.check(_archive(tmp_path / "places.pmtiles", good_dots), national=False) == []
    assert check_overlays.check(_archive(tmp_path / "lines.pmtiles", [], [_line(1, 2)]), national=False) == []
    assert check_overlays.check(_archive(tmp_path / "risk.pmtiles", [], risk=_lowest_risk_lines()), national=False) == []


@pytest.mark.parametrize(
    ("properties", "lonlat", "expected"),
    [
        ({"k": "zzz"}, LYON, "unknown kind id 'zzz'"),
        ({"k": "gp", "n": "Docteur Dupont"}, LYON, "gp is not a named kind"),
        ({"k": "pha", "n": "Pharmacie"}, LYON, "pha is not a named kind"),
        ({"k": "hos", "n": "H" * 61}, LYON, "over 60 characters"),
        ({"k": "hos", "n": ""}, LYON, "over 60 characters"),
        ({"k": "gp", "c": 1}, LYON, "count 1 must be an integer of 2 or more"),
        ({"k": "gp", "a": 0}, LYON, "approximate flag 0 must be 1"),
        ({"k": "gp", "siret": "123"}, LYON, "unexpected properties ['siret']"),
        ({"k": "gp"}, (55.45, -20.88), "outside metropolitan France"),
        ({"k": "gp"}, (-9.0, 45.0), "outside metropolitan France"),
        ({"k": "gp"}, (4.8, 52.5), "outside metropolitan France"),
    ],
)
def test_a_bad_dot_fails_the_gate(tmp_path: Path, properties: dict, lonlat: tuple[float, float], expected: str) -> None:
    path = _archive(tmp_path / "bad.pmtiles", [_dot(1, properties, lonlat)])
    problems = check_overlays.check(path, national=False)
    assert any(expected in problem for problem in problems), problems


def test_a_dot_below_its_kind_minzoom_fails_the_gate(tmp_path: Path) -> None:
    # hospitals start at z6 in kinds.json; this one is also in the z5 tile
    path = _archive(tmp_path / "early.pmtiles", [_dot(1, {"k": "hos"}, minzoom=5)])
    assert any("below its minzoom 6" in problem for problem in check_overlays.check(path, national=False))


@pytest.mark.parametrize("zone", [0, 1, 6])
def test_a_seismic_zone_outside_2_to_5_fails_the_gate(tmp_path: Path, zone: int) -> None:
    path = _archive(tmp_path / "zone.pmtiles", [], [_line(1, zone)])
    assert any("expected 2 to 5" in problem for problem in check_overlays.check(path, national=False))


@pytest.mark.parametrize(
    ("properties", "expected"),
    [
        ({"r": "landslide", "z": 1}, "unknown overlay id 'landslide'"),
        ({"r": "seismic", "z": 2}, "unknown overlay id 'seismic'"),
        ({"r": "flood", "z": 0}, "flood line with level 0"),
        ({"r": "flood", "z": 4}, "flood line with level 4"),
        ({"r": "radon", "z": 1}, "radon line with level 1"),
        ({"r": "cavities", "z": 2}, "cavities line with level 2"),
        ({"r": "clay", "z": "1"}, "clay line with level '1'"),
        ({"r": "flood"}, "properties ['r']"),
        ({"z": 1}, "properties ['z']"),
        ({"r": "flood", "z": 1, "fl": 1}, "properties ['fl', 'r', 'z']"),
    ],
)
def test_a_bad_risk_line_fails_the_gate(tmp_path: Path, properties: dict, expected: str) -> None:
    path = _archive(tmp_path / "bad.pmtiles", [], risk=[_risk_line(1, "", 0, properties)])
    problems = check_overlays.check(path, national=False)
    assert any(expected in problem for problem in problems), problems


def test_every_level_of_the_risk_table_passes_the_gate(tmp_path: Path) -> None:
    every = [_risk_line(i, risk, level) for i, (risk, d) in enumerate(RISKS.items()) for level in d.levels]
    assert check_overlays.check(_archive(tmp_path / "every.pmtiles", [], risk=every), national=False) == []


def test_a_risk_feature_that_is_not_a_line_fails_the_gate(tmp_path: Path) -> None:
    (point,) = to_web_mercator([Point(*LYON)])
    path = _archive(tmp_path / "point.pmtiles", [], risk=[TileFeature(1, {"r": "flood", "z": 1}, point)])
    assert any("is a Point" in problem for problem in check_overlays.check(path, national=False))


def test_a_tile_over_the_cap_fails_the_gate(tmp_path: Path, good_dots: list[TileFeature], monkeypatch) -> None:
    path = _archive(tmp_path / "heavy.pmtiles", good_dots)
    monkeypatch.setattr(check_overlays, "MAX_TILE_BYTES", 50)
    assert any("gzipped (cap 50)" in problem for problem in check_overlays.check(path, national=False))


def test_an_unreadable_file_fails_the_gate(tmp_path: Path, good_dots: list[TileFeature]) -> None:
    garbage = tmp_path / "garbage.pmtiles"
    garbage.write_bytes(b"not a pmtiles file" * 100)
    assert any("unreadable" in problem for problem in check_overlays.check(garbage, national=False))
    whole = _archive(tmp_path / "whole.pmtiles", good_dots).read_bytes()
    truncated = tmp_path / "truncated.pmtiles"
    truncated.write_bytes(whole[: len(whole) // 2])
    assert any("unreadable" in problem for problem in check_overlays.check(truncated, national=False))
    assert any("unreadable" in problem for problem in check_overlays.check(tmp_path / "absent.pmtiles", national=False))


def test_the_national_gate_wants_every_kind_and_every_seismic_level(tmp_path: Path, good_dots: list[TileFeature]) -> None:
    path = _archive(tmp_path / "partial.pmtiles", good_dots, [_line(10, 2)])
    problems = check_overlays.check(path, national=True)
    assert "kind bak is missing from the places" in problems
    assert "no seismic line for zone 3" in problems
    assert "no seismic line for zone 4" in problems
    assert "no risk feature in the archive" in problems
    for risk, definition in RISKS.items():
        assert f"no {risk} line at its lowest level {definition.levels[0]}: check {definition.property} in the communes archive" in problems


def test_the_national_gate_passes_when_every_count_is_in_range(tmp_path: Path, monkeypatch) -> None:
    dots = [_dot(i, {"k": kind}, (4.0 + 0.01 * i, 45.0)) for i, kind in enumerate(KINDS)]
    path = _archive(tmp_path / "national.pmtiles", dots, [_line(100 + z, z) for z in (2, 3, 4)], risk=_lowest_risk_lines())
    monkeypatch.setattr(check_overlays, "DOT_COUNT_RANGES", {kind: (1, 1) for kind in KINDS})
    assert check_overlays.check(path, national=True) == []
    monkeypatch.setattr(check_overlays, "DOT_COUNT_RANGES", {kind: (2, 9) for kind in KINDS})
    problems = check_overlays.check(path, national=True)
    assert "kind hos has 1 dots (expected 2 to 9)" in problems


def test_the_national_gate_names_the_risk_whose_lowest_level_has_no_line(tmp_path: Path, monkeypatch) -> None:
    dots = [_dot(i, {"k": kind}, (4.0 + 0.01 * i, 45.0)) for i, kind in enumerate(KINDS)]
    monkeypatch.setattr(check_overlays, "DOT_COUNT_RANGES", {kind: (1, 1) for kind in KINDS})
    higher_only = [_risk_line(1, "flood", 2), *_lowest_risk_lines()[1:]]
    path = _archive(tmp_path / "national.pmtiles", dots, [_line(100 + z, z) for z in (2, 3, 4)], risk=higher_only)
    assert check_overlays.check(path, national=True) == [
        "no flood line at its lowest level 1: check fl in the communes archive"
    ]


def test_a_dot_in_a_tile_buffer_is_counted_once(tmp_path: Path, monkeypatch) -> None:
    (centre,) = to_web_mercator([Point(*LYON)])
    span = WORLD / (1 << 12)
    column = int((centre.x + MERCATOR_HALF_WORLD) // span)
    row = int((MERCATOR_HALF_WORLD - centre.y) // span)
    east_edge = tile_bounds(12, column, row)[2]
    # 5 units inside the east edge of a z12 tile: also in the buffer of its eastern neighbour
    dot = TileFeature(1, {"k": "gp"}, Point(east_edge - 5 * span / EXTENT, centre.y))
    path = _archive(tmp_path / "edge.pmtiles", [dot])
    monkeypatch.setattr(check_overlays, "DOT_COUNT_RANGES", {"gp": (1, 1)})
    problems = check_overlays.check(path, national=True)
    assert not [problem for problem in problems if problem.startswith("kind gp ")], problems


def test_the_command_line_exits_non_zero_on_a_problem(tmp_path: Path, good_dots: list[TileFeature]) -> None:
    ok = _archive(tmp_path / "ok.pmtiles", good_dots)
    bad = _archive(tmp_path / "bad.pmtiles", [_dot(1, {"k": "gp", "n": "Docteur Dupont"})])

    def run(path: Path, *flags: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(CHECK_SCRIPT), str(path), *flags], capture_output=True, text=True, check=False)

    assert run(ok, "--slice").returncode == 0
    assert run(ok).returncode == 1, "a national gate on a three-dot archive must fail"
    failed = run(bad, "--slice")
    assert failed.returncode == 1
    assert "FAIL: gp is not a named kind" in failed.stdout


def test_every_kind_has_a_national_range() -> None:
    assert set(check_overlays.DOT_COUNT_RANGES) == set(KINDS)
    for kind, (low, high) in check_overlays.DOT_COUNT_RANGES.items():
        national = check_overlays.NATIONAL_DOTS[kind]
        assert low < national < high
        assert low == int(0.85 * national) and high >= 1.25 * national
