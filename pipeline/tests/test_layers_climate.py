import gzip
import hashlib
import io
import math
import tarfile
from pathlib import Path

import numpy as np
import pytest
import requests
from shapely.geometry import box

from settling.boundaries import Area
from settling.layers import LayerContext, check_properties
from settling.layers import climate
from settling.layers.climate import Interpolated, Station
from settling.sources import SourceError

MONTHS = "            ;     Janv.;     Févr.;      Mars;     Avril;       Mai;      Juin;     Juil.;      Août;     Sept.;      Oct.;      Nov.;      Déc.;     Année;"


def _row(label: str, annual: str) -> str:
    return f"{label:<12};" + "".join(f"{'1.0':>10};" for _ in range(12)) + f"{annual:>10};"


def fiche(
    header: str = """NICE (06)      Indicatif : 06088001, alt : 2m, lat : 43°38'54"N, lon : 7°12'33"E;""",
    sun: str | None = "2760.5",
    sun_period: str | None = None,
    hot: str = "8.5",
    hot_period: str | None = None,
) -> str:
    """A station sheet laid out like the Météo-France `.data` files (CRLF, `;`-separated, 1991-2020)."""
    sun_lines = ["Données non disponibles;"] if sun is None else [_row("", sun)]
    lines = [
        "FICHE CLIMATOLOGIQUE;", ";", "Statistiques  1991-2020  et  records;", header,
        "Edité le : 06/11/2026 dans l'état de la base;", "", "", MONTHS, "", "",
        "Température maximale (Moyenne en °C);", *([hot_period] if hot_period else []), _row("", "20.1"), "", "",
        "Nombre moyen de jours avec;", *([hot_period] if hot_period else []),
        _row("Tx >=  30°C ", hot), _row("Tx >=  25°C ", "84.3"), _row("Tn <=   0°C ", "43.5"),
        "(Tn=Température minimale. Tx=Température maximale);", "", "",
        "Nombre moyen de jours avec;", _row("Rr >=  1 mm ", "100.4"), _row("Rr >= 10 mm ", "23.8"), "", "",
        "Rayonnement global (Moyenne en J/cm²);", "Données non disponibles;", "", "", "",
        "Durée d'insolation (Moyenne en heures);", *([sun_period] if sun_period else []), *sun_lines, "", "", "",
        "- : donnée manquante;  . : donnée égale à 0;",
    ]
    return "\r\n".join(lines) + "\r\n"


def station(station_id: str = "06088001", **changes) -> Station:
    values = dict(station_id=station_id, name="X", lon=7.0, lat=43.6, alt=10, sun=2700.0, sun_from=1991, sun_to=2020,
                  hot=10.0, hot_from=1991, hot_to=2020, edited="2026-11-06")
    return Station(**(values | changes))


# --- parsing ----------------------------------------------------------------------------------------------


def test_sheet_gives_annual_sunshine_hot_days_position_and_altitude() -> None:
    parsed = climate.parse_fiche(fiche())
    assert parsed == Station("06088001", "NICE (06)", pytest.approx(7.2091667), pytest.approx(43.6483333), 2,
                             2760.5, 1991, 2020, 8.5, 1991, 2020, "2026-11-06")


def test_west_and_south_coordinates_are_negative() -> None:
    parsed = climate.parse_fiche(fiche(header='BREST-GUIPAVAS (29)      Indicatif : 29075001, alt : 92m, lat : 48°26\'40"S, lon : 4°24\'43"O;'))
    assert parsed.lon == pytest.approx(-(4 + 24 / 60 + 43 / 3600))
    assert parsed.lat < 0


def test_section_period_is_read_and_unavailable_sunshine_is_absent() -> None:
    parsed = climate.parse_fiche(fiche(sun=None, hot="18.7", hot_period="Statistiques établies sur la période 2004-2020;"))
    assert (parsed.sun, parsed.sun_from, parsed.sun_to) == (None, None, None)
    assert (parsed.hot, parsed.hot_from, parsed.hot_to) == (18.7, 2004, 2020)


@pytest.mark.parametrize(("annual", "value"), [(".", 0.0), ("-", None), ("32.8", 32.8)])
def test_dot_means_zero_and_dash_means_missing(annual: str, value: float | None) -> None:
    assert climate.parse_fiche(fiche(hot=annual)).hot == value


def test_sunshine_period_shorter_than_normals_is_kept_on_the_station() -> None:
    parsed = climate.parse_fiche(fiche(sun_period="Statistiques établies sur la période 1991-2018;"))
    assert (parsed.sun, parsed.sun_from, parsed.sun_to) == (2760.5, 1991, 2018)


def test_unrecognised_header_is_not_a_station() -> None:
    assert climate.parse_fiche("FICHE CLIMATOLOGIQUE;\r\nsomething else\r\n") is None


@pytest.mark.parametrize(
    ("start", "end", "kept"),
    [(1991, 2020, True), (1991, 2018, True), (1996, 2020, True), (1997, 2020, False), (2007, 2020, False),
     (1985, 2020, False), (1991, 2021, False)],
)
def test_only_normals_spanning_25_years_within_1991_2020_are_used(start: int, end: int, kept: bool) -> None:
    assert (climate.normal(station(hot_from=start, hot_to=end), "hot") is not None) is kept


def test_station_table_round_trip(tmp_path: Path) -> None:
    stations = [station("29075001", sun=None, sun_from=None, sun_to=None, hot=0.0), station("06088001")]
    path = tmp_path / "stations.csv"
    climate.write_stations(path, stations)
    assert climate.read_stations(path) == sorted(stations, key=lambda s: s.station_id)


def test_station_table_without_expected_columns_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "stations.csv"
    path.write_text("station_id,name\n1,x\n", encoding="utf-8")
    with pytest.raises(SourceError, match="lacks columns"):
        climate.read_stations(path)


@pytest.mark.parametrize("compress", [True, False])
def test_body_is_gunzipped_only_when_it_is_gzip(compress: bool) -> None:
    text = fiche().encode()
    assert climate.decode_body(gzip.compress(text) if compress else text) == text


# --- interpolation ----------------------------------------------------------------------------------------


def test_station_at_the_target_dominates_and_far_stations_are_ignored() -> None:
    stations = np.array([[0.0, 0.0, 100.0], [10_000.0, 0.0, 100.0], [200_000.0, 0.0, 100.0]])
    result = climate.interpolate(stations, np.array([10.0, 40.0, 99.0]), np.array([[0.0, 0.0, 100.0]]), 50_000.0)
    # weights 1/1 km² (floor) and 1/10 km²: (10 * 1 + 40 * 0.01) / 1.01
    assert result.values[0] == pytest.approx((10 + 40 * 0.01) / 1.01)
    assert result.contributors[0] == 2
    assert result.nearest_m[0] == 0.0


def test_no_station_within_the_cutoff_leaves_the_value_absent() -> None:
    result = climate.interpolate(np.array([[0.0, 0.0, 0.0]]), np.array([5.0]), np.array([[60_000.0, 0.0, 0.0]]), 50_000.0)
    assert math.isnan(result.values[0]) and math.isnan(result.nearest_m[0])
    assert result.contributors[0] == 0


def test_altitude_difference_counts_as_distance() -> None:
    # Same horizontal spot, 300 m higher: 60 km effective, beyond a 50 km cutoff; the low station 30 km away counts.
    stations = np.array([[0.0, 0.0, 1300.0], [30_000.0, 0.0, 1000.0]])
    result = climate.interpolate(stations, np.array([2.0, 30.0]), np.array([[0.0, 0.0, 1000.0]]), 50_000.0)
    assert result.values[0] == pytest.approx(30.0)
    assert result.nearest_m[0] == pytest.approx(30_000.0)


def test_target_without_altitude_gets_no_value() -> None:
    result = climate.interpolate(np.array([[0.0, 0.0, 0.0]]), np.array([5.0]), np.array([[0.0, 0.0, np.nan]]), 50_000.0)
    assert math.isnan(result.values[0])


def test_properties_round_and_cd_is_the_farther_nearest_station() -> None:
    sun = Interpolated(np.array([2764.9, np.nan, 2755.0]), np.array([12_400.0, np.nan, 3_000.0]), np.array([3, 0, 1]))
    hot = Interpolated(np.array([8.5, 12.49, np.nan]), np.array([2_000.0, 7_600.0, np.nan]), np.array([5, 5, 0]))
    assert climate.to_properties(["a", "b", "c"], sun, hot) == {
        "a": {"sun": 2760, "hot": 9, "cd": 12},
        "b": {"hot": 12, "cd": 8},
        "c": {"sun": 2760, "cd": 3},
    }


def test_chef_lieu_is_the_target_point_when_known() -> None:
    origins = np.array([[1.0, 2.0], [3.0, 4.0]])
    targets, is_chef_lieu = climate.target_points(["06088", "99999"], origins, {"06088": (7.2714, 43.6960)})
    assert is_chef_lieu.tolist() == [True, False]
    assert targets[0] == pytest.approx([1_044_000, 6_299_000], abs=2_000)  # Nice town hall area, Lambert-93
    assert targets[1].tolist() == [3.0, 4.0]


# --- altimetry --------------------------------------------------------------------------------------------


class FakeResponse:
    def __init__(self, status: int, payload: dict | None = None) -> None:
        self.status_code = status
        self.payload = payload

    def json(self) -> dict:
        return self.payload


class FakeAltimetry:
    def __init__(self, fail_first: int = 0) -> None:
        self.sizes: list[int] = []
        self.fail_first = fail_first

    def post(self, url: str, json: dict, timeout: int) -> FakeResponse:
        if self.fail_first:
            self.fail_first -= 1
            return FakeResponse(429)
        lons = json["lon"].split("|")
        self.sizes.append(len(lons))
        return FakeResponse(200, {"elevations": [-99999.0 if float(x) > 9 else 100.0 for x in lons]})


def test_altitudes_are_asked_in_small_batches_and_off_model_points_are_nan() -> None:
    api = FakeAltimetry()
    lonlat = np.array([[1.0, 45.0]] * 85 + [[10.0, 45.0]])
    values = climate.query_altitudes(api, lonlat, sleep=lambda s: None)
    assert sorted(api.sizes) == [6, 40, 40]
    assert np.isnan(values[-1]) and (values[:-1] == 100.0).all()


def test_altimetry_is_retried_then_fails_loudly() -> None:
    assert climate.query_altitudes(FakeAltimetry(fail_first=1), np.array([[1.0, 45.0]]), sleep=lambda s: None)[0] == 100.0
    with pytest.raises(SourceError, match="HTTP 429"):
        climate.query_altitudes(FakeAltimetry(fail_first=99), np.array([[1.0, 45.0]]), sleep=lambda s: None)


# --- dataset resolution -----------------------------------------------------------------------------------


class FakeDataGouv:
    def __init__(self, organisation: str) -> None:
        self.organisation = organisation

    def get(self, url: str, timeout: int) -> "FakeDataGouv":
        return self

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        base = "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/REF_STATION"
        return {
            "organization": {"name": self.organisation},
            "last_update": "2026-11-06T07:02:35+00:00",
            "resources": [{"url": f"{base}/FICHECLIM_06088001.data"}, {"url": f"{base}/FICHECLIM_06088001.pdf"},
                          {"url": f"{base}/liste_fiches_clim.geojson"}],
        }


def test_only_data_sheets_of_the_meteo_france_dataset_are_listed() -> None:
    index = climate.resolve_fiches(FakeDataGouv("Météo-France"))
    assert index.urls == {"06088001": "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/REF_STATION/FICHECLIM_06088001.data"}
    with pytest.raises(SourceError, match="expected Météo-France"):
        climate.resolve_fiches(FakeDataGouv("Someone re-uploading"))


# --- layer ------------------------------------------------------------------------------------------------


def test_compute_from_a_station_table_marks_distance_and_leaves_far_communes_absent(tmp_path: Path, monkeypatch) -> None:
    table = tmp_path / "stations.csv"
    climate.write_stations(table, [
        station("13054001", lon=5.2156, lat=43.4377, alt=6, sun=2897.6, hot=50.6),  # Marignane
        station("13054002", lon=5.2156, lat=43.4377, alt=6, sun=1000.0, hot=99.0, hot_from=2007, sun_from=2007),  # short
        station("97101001", lon=-61.5, lat=16.2, sun=2900.0, hot=80.0),  # overseas
    ])
    communes = [
        Area("13201", "Marseille 1er", "13", box(5.37, 43.29, 5.39, 43.31)),
        Area("29019", "Brest", "29", box(-4.50, 48.38, -4.48, 48.40)),
        Area("97101", "Les Abymes", "971", box(-61.51, 16.26, -61.49, 16.28)),
    ]
    chef_lieux = {"13201": (5.3811, 43.2965), "29019": (-4.4861, 48.3904), "97101": (-61.50, 16.27)}
    monkeypatch.setattr(climate, "fetch_chef_lieux", lambda session, raw: ("edition", chef_lieux))
    asked: list[list[str]] = []

    def altitudes(session, raw, codes, lonlat):
        asked.append(codes)
        return np.full(len(codes), 20.0)

    monkeypatch.setattr(climate, "cached_altitudes", altitudes)
    archive = tracc_tar(tmp_path, monkeypatch, {
        "q50": [(1, 43.2965, 5.3811, "60 days 12:00:00.0"), (2, 48.3904, -4.4861, "3 days 06:00:00.0")],
        "min": [(1, 43.2965, 5.3811, "40 days 00:00:00.0"), (2, 48.3904, -4.4861, "1 days 00:00:00.0")],
        "max": [(1, 43.2965, 5.3811, "80 days 00:00:00.0"), (2, 48.3904, -4.4861, "9 days 00:00:00.0")],
    })
    ctx = LayerContext(session=requests.Session(), raw=tmp_path, communes=communes, merged_codes={},
                       origins=np.zeros((3, 2)), overrides={"climate": table, "climate_tracc": archive})
    result = climate.compute(ctx)
    assert asked == [["13201", "29019"]]  # overseas out of scope, no altitude asked
    # Marignane station to the Marseille 1er town hall: 21 km, as in the national build. Brest has no station
    # but a grid point, so it gets the projection only.
    assert result.properties == {"13201": {"sun": 2900, "hot": 51, "cd": 21, "h50": 61}, "29019": {"h50": 3}}
    assert result.source["h50_projection"]["sha256"] == climate.TRACC_SHA256
    assert result.report["stations_used"] == {"sun": 1, "hot": 1}
    assert result.report["coverage"] == {"sun": 1, "hot": 1, "cd": 1, "h50": 2}
    assert result.source["licence"] == "Licence Ouverte / Etalab 2.0"


def test_gate_checks_spot_values_of_present_communes_only() -> None:
    communes = {"06088": {"sun": 2760, "hot": 12, "cd": 7}, "29019": {"sun": 2400, "hot": 1, "cd": 10}}
    assert climate.gate(communes) == ["29019.sun = 2400, expected 1450..1660"]


def test_gate_requires_a_station_distance_with_every_value() -> None:
    assert climate.gate({"01001": {"hot": 5}}) == ["1 communes have a climate value without station distance cd, e.g. ['01001']"]


def test_gate_compares_sunny_and_dull_departments() -> None:
    communes = {f"13{i:03d}": {"sun": 2000, "cd": 1} for i in range(300, 330)}
    communes |= {f"29{i:03d}": {"sun": 1900, "cd": 1} for i in range(300, 330)}
    assert any("median sunshine" in p for p in climate.gate(communes))


def test_gate_checks_national_coverage_only_on_a_national_build() -> None:
    national = {f"{i:05d}": ({"sun": 2000, "hot": 10, "cd": 5} if i % 2 else {}) for i in range(30_000)}
    problems = climate.gate(national)
    assert any(p.startswith("sun present for 50.0%") for p in problems)
    assert climate.gate({k: v for k, v in list(national.items())[:100]}) == []


def test_layer_ranges_accept_the_extremes_of_the_national_build() -> None:
    communes = {"a": {"sun": 1550, "hot": 0, "cd": 0}, "b": {"sun": 2900, "hot": 71, "cd": 80}}
    assert check_properties([climate.LAYER], communes) == []


# --- TRACC projection (h50) -------------------------------------------------------------------------------


def tracc_csv(rows: list[tuple[int, float, float, str]], indicator: str = "TX30D", rwl: str = "RWL-27") -> str:
    """Laid out like the TRACC-2023 TX30D CSVs of the probe of 2026-11-06 (values as pandas timedeltas, and
    the misleading "Modele" label the real ENSq50 file carries)."""
    rule = "#" + "-" * 77
    head = [
        rule, "# Date d'extraction : 09/05/2025", rule, "# Producteur : MF-DCSC", "# Experience : TRACC-2023",
        "# Modele     : MAX de l’ensemble EXPLORE2  / ADAMONT / RCP8.5",
        "# Niveau de réchauffement régional (RWL) :2.7°C", rule, "# Indices : ",
        f"#    {indicator} : Nombre de jours avec une température maximale ≥ 30 °C ",
        "#     Moyenne temporelle sur la période autour du niveau de réchauffement ", "#     Valeur absolue",
        rule, "# Format des enregistrements ", f"# Point;Latitude;Longitude;RWL;{indicator};", rule, "",
        "Point;Latitude;Longitude;RWL;Value",
    ]
    body = [f"{point};{lat};{lon};{rwl};{value}" for point, lat, lon, value in rows]
    return "\n".join(head + body) + "\n"


def tracc_tar(tmp_path: Path, monkeypatch, rows: dict[str, list]) -> Path:
    """A tiny archive with the three TX30D members; its sha256 is pinned in place of the real one."""
    path = tmp_path / "tracc.tar"
    with tarfile.open(path, "w") as tar:
        for stat, member_rows in rows.items():
            data = tracc_csv(member_rows).encode()
            info = tarfile.TarInfo(climate.TRACC_MEMBERS[stat])
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    monkeypatch.setattr(climate, "TRACC_SHA256", hashlib.sha256(path.read_bytes()).hexdigest())
    return path


SEA = (0, 41.3614, -4.0969, "nan")  # first row of the real files


@pytest.mark.parametrize(
    ("text", "days"),
    [("6 days 08:23:59.991760256", 6.35), ("0 days 17:36:00.001373290", 0.7333), ("12.5", 12.5)],
)
def test_tracc_day_counts_are_read_from_timedeltas(text: str, days: float) -> None:
    assert climate.tracc_days(text) == pytest.approx(days, abs=1e-4)


def test_tracc_nan_is_nan_and_garbage_fails() -> None:
    assert math.isnan(climate.tracc_days("nan"))
    with pytest.raises(SourceError, match="neither"):
        climate.tracc_days("six")


def test_tracc_csv_keeps_points_with_a_value() -> None:
    grid = climate.parse_tracc_csv(tracc_csv([SEA, (14014, 48.3821, -4.9622, "1 days 07:11:59.995880128")]))
    assert grid.point.tolist() == [14014]
    assert grid.value[0] == pytest.approx(1.3)
    assert (grid.lon[0], grid.lat[0]) == (-4.9622, 48.3821)


@pytest.mark.parametrize(
    ("text", "message"),
    [(tracc_csv([SEA], indicator="TX35D"), "does not describe TX30D"),
     (tracc_csv([(1, 45.0, 5.0, "1 days 00:00:00.0")], rwl="REF"), "expected RWL-27"),
     (tracc_csv([SEA]), "no value")],
)
def test_tracc_csv_is_checked(text: str, message: str) -> None:
    with pytest.raises(SourceError, match=message):
        climate.parse_tracc_csv(text)


def _grid(values: list[float]) -> climate.TraccGrid:
    n = len(values)
    return climate.TraccGrid(np.arange(n), np.full(n, 5.0), np.full(n, 45.0), np.array(values, dtype=float))


def test_ensemble_order_confirms_the_file_names() -> None:
    assert climate.check_ensemble_order({"q50": _grid([5, 6]), "min": _grid([4, 6]), "max": _grid([9, 6])}) == []
    # what the in-file labels claim: the "ENSq50" file is the maximum
    swapped = climate.check_ensemble_order({"q50": _grid([9, 6]), "min": _grid([4, 6]), "max": _grid([5, 6])})
    assert swapped == ["ENSq50 is above ENSmax at 1 grid points"]


def test_nearest_grid_point_within_the_cutoff_only() -> None:
    grid = climate.TraccGrid(np.array([1]), np.array([5.3811]), np.array([43.2965]), np.array([60.4]))
    targets, _ = climate.target_points(["13201", "29019"], np.zeros((2, 2)),
                                       {"13201": (5.3811, 43.2965), "29019": (-4.4861, 48.3904)})
    values, distances = climate.nearest_grid_values(grid, np.vstack([targets, [[np.nan, np.nan]]]), 8000.0)
    assert values[0] == pytest.approx(60.4) and distances[0] == pytest.approx(0.0, abs=1.0)
    assert np.isnan(values[1:]).all()


def test_projection_is_rounded_and_absent_stays_absent() -> None:
    properties = {"a": {"hot": 3, "cd": 4}}
    climate.add_projection(properties, ["a", "b", "c"], np.array([10.5, 2.4, np.nan]))
    assert properties == {"a": {"hot": 3, "cd": 4, "h50": 11}, "b": {"h50": 2}}


def _tracc_ctx(tmp_path: Path, overrides: dict) -> LayerContext:
    return LayerContext(session=requests.Session(), raw=tmp_path, communes=[], merged_codes={},
                        origins=np.zeros((0, 2)), overrides=overrides)


def test_blocked_archive_leaves_h50_absent_with_the_reason(tmp_path: Path, monkeypatch) -> None:
    def blocked(*args, **kwargs):
        raise SourceError("url: HTTP 403 (text/html). A proxy may be blocking this file type; download it ...")

    monkeypatch.setattr(climate, "download", blocked)
    values, source, report = climate.tracc_h50(_tracc_ctx(tmp_path, {}), np.zeros((1, 2)), np.array([True]))
    assert np.isnan(values).all() and "proxy may be blocking" in source["unavailable"] and report == {}


def test_archive_other_than_the_pinned_one_is_refused(tmp_path: Path) -> None:
    other = tmp_path / "other.tar"
    other.write_bytes(b"not the pinned archive")
    with pytest.raises(SourceError, match="differs from the pinned"):
        climate.tracc_h50(_tracc_ctx(tmp_path, {"climate_tracc": other}), np.zeros((1, 2)), np.array([True]))


def test_inconsistent_ensemble_statistics_fail_the_layer(tmp_path: Path, monkeypatch) -> None:
    point = [(1, 43.2965, 5.3811, "60 days 00:00:00.0")]
    archive = tracc_tar(tmp_path, monkeypatch, {"q50": point, "min": point,
                                                "max": [(1, 43.2965, 5.3811, "50 days 00:00:00.0")]})
    with pytest.raises(SourceError, match="above ENSmax"):
        climate.tracc_h50(_tracc_ctx(tmp_path, {"climate_tracc": archive}), np.zeros((1, 2)), np.array([True]))


def test_gate_wants_h50_mostly_at_or_above_hot() -> None:
    communes = {f"01{i:03d}": {"hot": 10, "h50": 5 if i < 5 else 20, "cd": 1} for i in range(30)}
    assert climate.gate(communes) == ["h50 >= hot for only 83.3% of communes, expected at least 90%"]


def test_gate_wants_the_mediterranean_well_above_brittany() -> None:
    communes = {f"13{i:03d}": {"h50": 30} for i in range(300, 330)} | {f"29{i:03d}": {"h50": 20} for i in range(300, 330)}
    assert climate.gate(communes) == ["median h50 ('13', '30', '34', '84') 30.0 d is not 20 d above ('22', '29', '35', '56') 20.0 d"]
