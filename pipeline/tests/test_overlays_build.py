import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from shapely.geometry import box

import check_overlays
from communes_archive import write_communes_archive
from settling import inputs
from settling.boundaries import Area, Boundaries
from settling.overlays import build
from settling.overlays.places import load_kinds
from settling.seismic import SeismicReport

COLUMNS = ("TYPEQU", "NOMRS", "STATUT_DIFFUSION", "EPSG", "QUALITE_XY", "LAMBERT_X", "LAMBERT_Y", "LONGITUDE", "LATITUDE", "DEP")
BPE_ROWS = [
    ("D101", "CENTRE HOSPITALIER DE LYON", "O", "2154", "B", 700_000.0, 6_600_000.0, 4.83, 45.76, "69"),
    ("D265", "DOCTEUR DUPONT", "_Z", "2154", "B", 700_000.0, 6_600_000.0, 4.84, 45.77, "69"),
    ("D265", "DOCTEUR MARTIN", "_Z", "2154", "M", 700_000.0, 6_600_000.0, 4.84, 45.77, "69"),
    ("D101", "HOPITAL PRIVE", "P", "2154", "B", None, None, None, None, "69"),
]
EXISTING_FILES = {"manifest.json": b"price manifest", "communes.pmtiles": b"price tiles"}


@pytest.fixture
def offline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(build, "open_session", lambda: None)
    monkeypatch.setattr(inputs, "resolve_bpe_release", lambda session: "2026-11-02")


@pytest.fixture
def out_dir(tmp_path: Path) -> Path:
    out = tmp_path / "out"
    out.mkdir()
    for name, content in EXISTING_FILES.items():
        (out / name).write_bytes(content)
    return out


@pytest.fixture
def bpe_file(tmp_path: Path) -> Path:
    path = tmp_path / "BPE25.parquet"
    pq.write_table(pa.table({name: [row[i] for row in BPE_ROWS] for i, name in enumerate(COLUMNS)}), path)
    return path


@pytest.fixture
def zoned_communes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two communes side by side, zone 1 and zone 2, instead of the Admin Express files and the Géorisques API."""
    communes = [Area("69001", "West", "69", box(4.7, 45.7, 4.8, 45.8)), Area("69002", "East", "69", box(4.8, 45.7, 4.9, 45.8))]
    edition = SimpleNamespace(edition_id="ADMIN-EXPRESS-TEST", edition_date="2026-01-01")
    report = SeismicReport(zones_in_source=2, communes=2, by_method={"own_code": 2}, by_zone={1: 1, 2: 1})
    monkeypatch.setattr(build, "fetch_admin_express", lambda session, raw: (edition, {}))
    monkeypatch.setattr(build, "load_boundaries", lambda paths, deps: Boundaries(communes, [communes[0]], {}))
    monkeypatch.setattr(
        build, "resolve_seismic_zones",
        lambda session, raw, override, areas, merged: ({"local_file": "zones.csv", "sha256": "abc"}, {"69001": 1, "69002": 2}, report),
    )


@pytest.fixture
def communes_file(tmp_path: Path, zoned_communes: None) -> Path:
    """The two zoned communes with their flood and cavity classes: West is class 0 for both, East floods at 2 and has
    8 cavities; neither has clay or radon."""
    west, east = build.load_boundaries({}, None).communes
    return write_communes_archive(
        tmp_path / "communes.pmtiles", {"69001": (west, {"fl": 0, "cv": 0}), "69002": (east, {"fl": 2, "cv": 8})}
    )


def _run(out: Path, *flags: str) -> None:
    build.main(["--out", str(out), "--workers", "1", *flags])


def test_the_places_build_writes_its_own_files_and_leaves_the_price_files(
    offline: None, out_dir: Path, bpe_file: Path
) -> None:
    _run(out_dir, "--dep", "69", "--bpe-file", str(bpe_file), "--only", "places")
    assert sorted(p.name for p in out_dir.iterdir()) == [
        "communes.pmtiles", "manifest.json", "overlays-report.json", "overlays.json", "overlays.pmtiles",
    ]
    assert {name: (out_dir / name).read_bytes() for name in EXISTING_FILES} == EXISTING_FILES

    manifest = json.loads((out_dir / "overlays.json").read_text(encoding="utf-8"))
    tiles = out_dir / "overlays.pmtiles"
    assert manifest["version"] == datetime.now(UTC).date().isoformat()
    assert manifest["tiles"]["file"] == "overlays.pmtiles"
    assert manifest["tiles"]["bytes"] == tiles.stat().st_size
    assert manifest["sources"]["bpe"]["page_release_date"] == "2026-11-02"
    assert manifest["sources"]["bpe"]["sha256"] == inputs.sha256_of(bpe_file)
    kinds = manifest["layers"]["places"]["kinds"]
    assert list(kinds) == [kind.id for kind in load_kinds()]
    assert (kinds["hos"], kinds["gp"], kinds["pha"]) == (1, 1, 0)
    assert manifest["layers"]["places"]["rows_skipped"] == {"partial_diffusion": 1}
    assert "seismic" not in manifest["layers"]
    assert check_overlays.check(tiles, national=False) == []

    report = json.loads((out_dir / "overlays-report.json").read_text(encoding="utf-8"))
    gp = report["layers"]["places"]["kinds"]["gp"]
    assert (gp["rows"], gp["dots"], gp["dots_sharing_position"], gp["approximate_dots"], gp["named_dots"]) == (2, 1, 1, 1, 0)
    assert report["scope"] == ["69"]


def test_a_department_without_places_stops_with_a_message(offline: None, out_dir: Path, bpe_file: Path) -> None:
    with pytest.raises(SystemExit, match="no place found"):
        _run(out_dir, "--dep", "01", "--bpe-file", str(bpe_file), "--only", "places")
    assert not (out_dir / "overlays.pmtiles").exists()


def test_the_seismic_build_draws_a_line_on_the_zone_change(offline: None, zoned_communes: None, out_dir: Path) -> None:
    _run(out_dir, "--dep", "69", "--only", "seismic")
    manifest = json.loads((out_dir / "overlays.json").read_text(encoding="utf-8"))
    assert manifest["layers"] == {"seismic": {"lines": {"2": 1}, "length_km": {"2": pytest.approx(11.1, abs=0.2)}}}
    assert manifest["sources"]["boundaries"] == {"edition_id": "ADMIN-EXPRESS-TEST", "edition_date": "2026-01-01"}
    assert manifest["sources"]["seismic"]["sha256"] == "abc"
    assert check_overlays.check(out_dir / "overlays.pmtiles", national=False) == []


def test_both_layers_go_into_one_archive_and_one_manifest(
    offline: None, zoned_communes: None, out_dir: Path, bpe_file: Path
) -> None:
    _run(out_dir, "--dep", "69", "--bpe-file", str(bpe_file))
    manifest = json.loads((out_dir / "overlays.json").read_text(encoding="utf-8"))
    assert set(manifest["layers"]) == {"places", "seismic"}, "without a communes archive the risk layer is left out"
    assert set(manifest["sources"]) == {"bpe", "seismic", "boundaries"}
    assert check_overlays.check(out_dir / "overlays.pmtiles", national=False) == []


def test_the_risk_layer_is_skipped_with_a_log_line_when_no_communes_archive_is_given(
    offline: None, zoned_communes: None, out_dir: Path, bpe_file: Path, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level("WARNING", logger="settling"):
        _run(out_dir, "--dep", "69", "--bpe-file", str(bpe_file))
    assert "risk layer skipped: pass --communes-file or --communes-url" in caplog.text


def test_asking_only_for_the_risk_layer_without_a_communes_archive_stops_with_a_message(
    offline: None, zoned_communes: None, out_dir: Path
) -> None:
    with pytest.raises(SystemExit, match="--only risk needs --communes-file or --communes-url"):
        _run(out_dir, "--dep", "69", "--only", "risk")
    assert not (out_dir / "overlays.pmtiles").exists()


def test_the_risk_build_draws_lines_where_a_class_rises_and_records_its_source(
    offline: None, zoned_communes: None, communes_file: Path, out_dir: Path
) -> None:
    _run(out_dir, "--dep", "69", "--only", "risk", "--communes-file", str(communes_file))
    manifest = json.loads((out_dir / "overlays.json").read_text(encoding="utf-8"))
    risk = manifest["layers"]["risk"]
    assert risk["lines"] == {"flood": {"2": 1}, "clay": {}, "radon": {}, "cavities": {"5": 1}}
    assert risk["length_km"]["flood"] == {"2": pytest.approx(11.1, abs=0.2)}
    digest = inputs.sha256_of(communes_file)
    assert risk["source"] == {"communes_version": "2026-11-06", "sha256": digest, "bytes": communes_file.stat().st_size}
    assert manifest["sources"]["communes"] == {
        "local_file": "communes.pmtiles", "bytes": communes_file.stat().st_size, "sha256": digest,
        "version": "2026-11-06", "zoom": 4,
    }
    assert set(manifest["layers"]) == {"risk"}
    assert check_overlays.check(out_dir / "overlays.pmtiles", national=False) == []

    report = json.loads((out_dir / "overlays-report.json").read_text(encoding="utf-8"))["layers"]["risk"]
    assert report["lines"] == risk["lines"]
    assert report["communes_without_value"]["flood"]["count"] == 0
    assert report["communes_without_value"]["clay"] == {
        "count": 2, "by_department": {"69": 2}, "sample": ["69001", "69002"],
    }
    assert report["archive"]["communes_without_boundary"] == {"count": 0, "sample": []}


def test_all_three_layers_go_into_one_archive(
    offline: None, communes_file: Path, out_dir: Path, bpe_file: Path
) -> None:
    _run(out_dir, "--dep", "69", "--bpe-file", str(bpe_file), "--communes-file", str(communes_file))
    manifest = json.loads((out_dir / "overlays.json").read_text(encoding="utf-8"))
    assert list(manifest["layers"]) == ["places", "seismic", "risk"]
    assert set(manifest["sources"]) == {"bpe", "seismic", "boundaries", "communes"}
    assert check_overlays.check(out_dir / "overlays.pmtiles", national=False) == []


def test_a_communes_url_is_downloaded_to_the_raw_cache_and_recorded(
    offline: None, communes_file: Path, out_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked = []

    def fetch(session, raw, url) -> Path:
        asked.append((raw, url))
        return communes_file

    monkeypatch.setattr(inputs, "fetch_communes_archive", fetch)
    url = "https://tiles.example/v2026-11-06/communes.pmtiles"
    _run(out_dir, "--dep", "69", "--only", "risk", "--communes-url", url, "--raw", str(tmp_path / "raw"))
    assert asked == [(tmp_path / "raw", url)]
    manifest = json.loads((out_dir / "overlays.json").read_text(encoding="utf-8"))
    assert manifest["sources"]["communes"]["url"] == url
    assert manifest["sources"]["communes"]["sha256"] == inputs.sha256_of(communes_file)


def test_a_missing_communes_file_stops_with_a_message(offline: None, zoned_communes: None, out_dir: Path, tmp_path: Path) -> None:
    with pytest.raises(SystemExit, match="no such file"):
        _run(out_dir, "--dep", "69", "--only", "risk", "--communes-file", str(tmp_path / "absent.pmtiles"))


def test_a_file_and_a_url_cannot_both_be_given(out_dir: Path, tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        _run(out_dir, "--communes-file", str(tmp_path / "a.pmtiles"), "--communes-url", "https://x.example/a.pmtiles")
