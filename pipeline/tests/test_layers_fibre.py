import struct
import zipfile
from pathlib import Path

import numpy as np
import pytest
import requests
from shapely.geometry import box

from settling.boundaries import Area
from settling.layers import LayerContext, check_properties, discover
from settling.layers import fibre
from settling.layers.fibre import LAYER, Premises
from settling.sources import SourceError

MCI_HEADER = (
    "code_insee;nom_com;code_dep;code_reg;nbr;type;elig_ftth;elig_coax;elig_cu;elig_thdr;elig_4gf;elig_hdr;elig_sat;date"
)
# Rows as published in 2026_T2 (Guéret, Saint-Éloi, Lièpvre, Bezonvaux, Paris), plus two former communes.
MCI_ROWS = [
    "23096;Guéret;23;75;10373;all;9965;0;10373;0;10300;0;10373;2026-06-30",
    "23191;Saint-Éloi;23;75;166;all;6;0;166;0;160;0;166;2026-06-30",
    "68185;Lièpvre;68;44;998;all;0;0;998;0;998;0;998;2026-06-30",
    "55050;Bezonvaux;55;44;0;all;0;0;0;0;0;0;0;2026-06-30",
    "75056;Paris;75;11;1665813;all;1597360;0;1665813;0;1665813;0;1665813;2026-06-30",
    "01002;Former A;01;84;100;all;100;0;100;0;100;0;100;2026-06-30",
    "01003;Former B;01;84;300;all;150;0;300;0;300;0;300;2026-06-30",
]
OBSERVATORY = [
    {"INSEE_COM": "75101", "Locaux": "24814.000000000000000", "ftth": "22660.000000000000000"},
    {"INSEE_COM": "13201", "Locaux": "31959.000000000000000", "ftth": "17094.000000000000000"},
    {"INSEE_COM": "23096", "Locaux": "10516.000000000000000", "ftth": "10066.000000000000000"},  # not used
]


def _mci_csv(path: Path, rows: list[str] = MCI_ROWS) -> Path:
    path.write_text("\n".join([MCI_HEADER, *rows]) + "\n", encoding="utf-8")
    return path


def _dbf(rows: list[dict[str, str]], deleted: tuple[int, ...] = ()) -> bytes:
    """A dBase III table with one character column per key, as in the observatory shapefile."""
    names = list(rows[0])
    width = 40
    header_bytes = 32 + 32 * len(names) + 1
    record_bytes = 1 + width * len(names)
    out = bytearray(struct.pack("<BBBBIHH20x", 3, 126, 9, 10, len(rows), header_bytes, record_bytes))
    for name in names:
        out += struct.pack("<11sc4xB15x", name.encode("latin-1"), b"C", width)
    out += b"\r"
    for index, row in enumerate(rows):
        out += b"*" if index in deleted else b" "
        for name in names:
            out += row[name].encode("utf-8").ljust(width)[:width]
    return bytes(out + b"\x1a")


def _observatory_zip(path: Path, rows: list[dict[str, str]] = OBSERVATORY, dbf_name: str = "communes_2026T2.dbf",
                     deleted: tuple[int, ...] = ()) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(dbf_name, _dbf(rows, deleted))
        archive.writestr(dbf_name.replace(".dbf", ".cpg"), "UTF-8")
    return path


@pytest.mark.parametrize(
    ("total", "ftth", "expected"),
    [(10373, 9965, 96), (166, 6, 4), (998, 0, 0), (283, 283, 100), (1000, 999, 99), (1000, 1, 1), (200, 107, 54),
     (31959, 17094, 53), (0, 0, None)],
)
def test_share_rounds_half_up_and_keeps_0_and_100_for_exact_cases(total: int, ftth: int, expected: int | None) -> None:
    assert fibre.share(Premises(total, ftth)) == expected


@pytest.mark.parametrize(
    ("date", "quarter"), [("2026-06-30", "2026_T2"), ("2025-12-31", "2025_T4"), ("2026-03-31", "2026_T1")]
)
def test_quarter_of(date: str, quarter: str) -> None:
    assert fibre.quarter_of(date) == quarter


def test_read_mci_counts_all_premises_per_commune(tmp_path: Path) -> None:
    date, counts = fibre.read_mci(_mci_csv(tmp_path / "commune_techno.csv"))
    assert date == "2026-06-30"
    assert counts["23096"] == Premises(10373, 9965)
    assert counts["55050"] == Premises(0, 0)


@pytest.mark.parametrize(
    ("row", "message"),
    [("23096;Guéret;23;75;10;all;11;0;0;0;0;0;0;2026-06-30", "FttH-eligible"),
     ("23001;X;23;75;10;all;5;0;0;0;0;0;0;2026-03-31", "one data date"),
     ("23096;Guéret;23;75;10;all;5;0;0;0;0;0;0;2026-06-30", "duplicate")],
)
def test_read_mci_rejects_inconsistent_files(tmp_path: Path, row: str, message: str) -> None:
    with pytest.raises(SourceError, match=message):
        fibre.read_mci(_mci_csv(tmp_path / "commune_techno.csv", [MCI_ROWS[0], row]))


def test_observatory_keeps_only_arrondissements_and_skips_deleted_records(tmp_path: Path) -> None:
    rows = [*OBSERVATORY, {"INSEE_COM": "75102", "Locaux": "1.0", "ftth": "1.0"}]
    quarter, counts = fibre.read_observatory_arrondissements(_observatory_zip(tmp_path / "o.zip", rows, deleted=(3,)))
    assert quarter == "2026_T2"
    assert counts == {"75101": Premises(24814, 22660), "13201": Premises(31959, 17094)}


def test_observatory_without_expected_columns_is_rejected(tmp_path: Path) -> None:
    path = _observatory_zip(tmp_path / "o.zip", [{"INSEE_COM": "75101", "Locaux": "1"}])
    with pytest.raises(SourceError, match="lacks columns"):
        fibre.read_observatory_arrondissements(path)


def test_shares_by_own_code_observatory_arrondissement_and_former_communes(tmp_path: Path) -> None:
    _, mci = fibre.read_mci(_mci_csv(tmp_path / "commune_techno.csv"))
    _, arrondissements = fibre.read_observatory_arrondissements(_observatory_zip(tmp_path / "o.zip"))
    codes = ["23096", "68185", "55050", "75101", "75102", "13201", "01001", "99999"]
    result = fibre.assign_shares(codes, mci, arrondissements, {"01002": "01001", "01003": "01001"})
    assert result.shares == {"23096": 96, "68185": 0, "75101": 91, "13201": 53, "01001": 63}
    assert result.by_method == {"former_communes": 1, "own_code": 2, "plm_observatory": 2}
    assert result.from_former_communes == [{"code": "01001", "fb": 63, "from": ["01002", "01003"]}]
    assert result.no_premises == ["55050"]  # 0 premises: unknown, never 0 %
    assert result.missing == ["75102", "99999"]  # an arrondissement never falls back to the city-wide figure


def test_former_code_that_is_itself_a_tile_commune_is_not_double_counted(tmp_path: Path) -> None:
    _, mci = fibre.read_mci(_mci_csv(tmp_path / "commune_techno.csv"))
    result = fibre.assign_shares(["01002", "01003"], mci, {}, {"01002": "01003"})
    assert result.shares == {"01002": 100, "01003": 50}


def test_plm_city_check_compares_the_two_publications() -> None:
    mci = {"75056": Premises(1665813, 1597360)}
    arrondissements = {"75101": Premises(24814, 22660), "75102": Premises(10, 10)}
    expected = {"75056": {"mci": 96, "observatory": 91, "arrondissements": 2}}
    assert fibre.plm_cross_check(mci, arrondissements) == expected


def _context(tmp_path: Path, codes: list[str]) -> LayerContext:
    folder = tmp_path / "files"
    folder.mkdir()
    _mci_csv(folder / fibre.MCI_FILE)
    _observatory_zip(folder / fibre.OBSERVATORY_FILE)
    communes = [Area(code, code, code[:2], box(i, 0, i + 1, 1)) for i, code in enumerate(codes)]
    return LayerContext(requests.Session(), tmp_path / "raw", communes, {}, np.zeros((len(codes), 2)),
                        overrides={fibre.NAME: folder})


def test_compute_from_local_files_reports_provenance_and_coverage(tmp_path: Path) -> None:
    result = LAYER.compute(_context(tmp_path, ["23096", "23191", "55050", "75101", "13201"]))
    assert result.properties == {"23096": {"fb": 96}, "23191": {"fb": 4}, "75101": {"fb": 91}, "13201": {"fb": 53}}
    assert all(isinstance(p["fb"], int) for p in result.properties.values())
    assert result.source["quarter"] == "2026_T2"
    assert result.source["data_date"] == "2026-06-30"
    assert "Licence Ouverte" in result.source["licence"]
    assert len(result.source["mci"]["sha256"]) == len(result.source["observatory"]["sha256"]) == 64
    assert result.report["present"] == 4
    assert result.report["no_premises"] == ["55050"]
    assert result.report["plm_city_check"] == {"75056": {"mci": 96, "observatory": 91, "arrondissements": 1}}


def test_compute_refuses_publications_of_different_quarters(tmp_path: Path) -> None:
    ctx = _context(tmp_path, ["23096"])
    _observatory_zip(ctx.overrides[fibre.NAME] / fibre.OBSERVATORY_FILE, dbf_name="communes_2026T1.dbf")
    with pytest.raises(SourceError, match="differs"):
        LAYER.compute(ctx)


def test_layer_is_discovered() -> None:
    assert "fibre" in [layer.name for layer in discover()]


def _national(**overrides: int) -> dict[str, dict]:
    """30,000 plausible communes (median 97, 2% below 50) plus the verified spot checks."""
    communes = {f"{n:05d}": {"fb": 30 if n % 50 == 0 else 97} for n in range(30_000)}
    communes |= {code: {"fb": value} for code, value in fibre.SPOT_CHECKS.items()}
    communes |= {f"751{n:02d}": {"fb": 95} for n in range(2, 21) if f"751{n:02d}" not in fibre.SPOT_CHECKS}
    communes |= {code: {} for code in fibre.MUST_BE_ABSENT}
    communes |= {code: {"fb": value} for code, value in overrides.items()}
    return communes


def test_gate_accepts_the_verified_national_picture() -> None:
    assert check_properties([LAYER], _national()) == []


def test_gate_flags_wrong_spot_check_published_unknown_and_paris_outlier() -> None:
    communes = _national(**{"23096": 90, "75102": 60})
    communes["55050"] = {"fb": 0}
    problems = check_properties([LAYER], communes)
    assert any("23096: fb 90 != 96" in p for p in problems)
    assert any("55050 has no premises" in p for p in problems)
    assert any("Paris arrondissements" in p for p in problems)


def test_gate_flags_a_saturated_or_collapsed_national_distribution() -> None:
    saturated = {f"{n:05d}": {"fb": 100} for n in range(30_000)}
    assert any("below 50%" in p for p in check_properties([LAYER], saturated))
    collapsed = {f"{n:05d}": {"fb": 40} for n in range(30_000)}
    assert any("national median" in p for p in check_properties([LAYER], collapsed))


def test_ranges_reject_values_outside_0_100() -> None:
    assert check_properties([LAYER], {"a": {"fb": 101}}) != []
