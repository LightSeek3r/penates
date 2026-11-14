import json
import re
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from settling.overlays import names
from settling.overlays.places import KINDS_FILE, Dot, dot_properties, load_kinds, read_places

APP_CATALOGUE = Path(__file__).parents[2] / "app" / "src" / "domain" / "overlays.ts"
COLUMNS = (
    "TYPEQU", "NOMRS", "STATUT_DIFFUSION", "EPSG", "QUALITE_XY", "LAMBERT_X", "LAMBERT_Y", "LONGITUDE", "LATITUDE", "DEP"
)
# Lambert-93 is anchored at 3°E 46.5°N; any pair inside the extent passes, longitude and latitude are what is tiled.
L93 = (700_000.0, 6_600_000.0)
LYON = (4.83, 45.76)
BPE_ROWS = [
    # TYPEQU, NOMRS, STATUT, EPSG, QUALITE_XY, X, Y, LON, LAT, DEP
    ("D101", "CENTRE HOSPITALIER DE LYON", "O", "2154", "B", *L93, *LYON, "69"),
    # three GPs at one address, one of them approximate: one dot, count 3, flagged approximate, never named
    ("D265", "CABINET DOCTEUR DUPONT", "_Z", "2154", "A", *L93, 4.84, 45.77, "69"),
    ("D265", "DOCTEUR MARTIN", "_Z", "2154", "B", *L93, 4.84, 45.77, "69"),
    ("D265", "DOCTEUR LEROY", "_Z", "2154", "M", *L93, 4.84, 45.77, "69"),
    ("D265", "DOCTEUR SOLO", "_Z", "2154", "B", *L93, 4.85, 45.78, "69"),
    ("D101", "HOPITAL PRIVE DE PARTIAL", "P", "2154", "B", None, None, None, None, "69"),  # partial diffusion
    ("D101", "HOPITAL DE LA REUNION", "O", "2975", "B", *L93, 55.45, -20.88, "69"),  # outside the metropole
    ("D101", "HOPITAL SANS XY", "O", "2154", "_U", None, None, None, None, "69"),  # not geolocated
    ("D101", "HOPITAL HORS CADRE", "O", "2154", "B", 0.0, 0.0, 0.0, 0.0, "69"),  # outside the Lambert-93 extent
    ("D101", "CLINIQUE SAINT LOUIS", "O", "2154", "B", *L93, 4.90, 45.70, "69"),  # same address, two names:
    ("D101", "CLINIQUE SAINT LOUIS", "O", "2154", "B", *L93, 4.90, 45.70, "69"),  # the most frequent one is shown
    ("D101", "POLE SANTE ANNEXE", "O", "2154", "B", *L93, 4.90, 45.70, "69"),
    ("D101", "_Z", "O", "2154", "B", *L93, 4.91, 45.71, "69"),  # no usable name: a dot without one
    ("D307", "PHARMACIE DE LA GARE", "O", "2154", "B", *L93, *LYON, "69"),  # same position as the hospital, another kind
    ("D106", "SERVICE D'URGENCES", "O", "2154", "B", *L93, *LYON, "69"),  # not a place kind
    ("C201", "COLLEGE AIN", "O", "2154", "A", *L93, 5.20, 46.20, "01"),  # another department
]


@pytest.fixture
def bpe_file(tmp_path: Path) -> Path:
    table = pa.table({name: [row[i] for row in BPE_ROWS] for i, name in enumerate(COLUMNS)})
    path = tmp_path / "bpe.parquet"
    pq.write_table(table, path)
    return path


def _dots(result, kind: str) -> list[Dot]:
    return [d for d in result.dots if d.kind == kind]


def test_rows_at_one_position_of_one_kind_become_one_dot_with_a_count(bpe_file: Path) -> None:
    result = read_places(bpe_file, load_kinds(), ["69"])
    gps = sorted(_dots(result, "gp"), key=lambda d: d.lon)
    assert [(d.rows, d.approximate, d.name) for d in gps] == [(3, True, None), (1, False, None)]
    assert dot_properties(gps[0]) == {"k": "gp", "c": 3, "a": 1}
    assert dot_properties(gps[1]) == {"k": "gp"}
    assert result.rows_by_kind["gp"] == 4


def test_the_same_position_keeps_one_dot_per_kind(bpe_file: Path) -> None:
    result = read_places(bpe_file, load_kinds(), ["69"])
    at_lyon = {d.kind for d in result.dots if (d.lon, d.lat) == LYON}
    assert at_lyon == {"hos", "pha"}


def test_skipped_rows_are_counted_by_reason(bpe_file: Path) -> None:
    result = read_places(bpe_file, load_kinds(), ["69"])
    assert result.rows_skipped == {"missing_or_invalid_xy": 2, "outside_metropole": 1, "partial_diffusion": 1}
    assert all("Partial" not in (d.name or "") for d in result.dots)


def test_a_named_kind_shows_the_most_frequent_name_and_drops_unusable_ones(bpe_file: Path) -> None:
    result = read_places(bpe_file, load_kinds(), ["69"])
    by_position = {(d.lon, d.lat): d for d in _dots(result, "hos")}
    assert by_position[(4.90, 45.70)].name == "Clinique Saint Louis"
    assert by_position[(4.90, 45.70)].rows == 3
    assert by_position[(4.91, 45.71)].name is None
    assert result.names_unusable == {"hos": 1}


def test_an_unnamed_kind_never_carries_a_name(bpe_file: Path) -> None:
    result = read_places(bpe_file, load_kinds(), None)
    unnamed = {kind.id for kind in load_kinds() if not kind.named}
    assert {"gp", "pha"} <= unnamed
    assert all(d.name is None for d in result.dots if d.kind in unnamed)
    assert all("n" not in dot_properties(d) for d in result.dots if d.kind in unnamed)


def test_departments_scope_the_dots(bpe_file: Path) -> None:
    kinds = load_kinds()
    assert {d.kind for d in read_places(bpe_file, kinds, ["01"]).dots} == {"col"}
    assert {d.kind for d in read_places(bpe_file, kinds, ["69"]).dots} == {"hos", "gp", "pha"}
    assert {d.kind for d in read_places(bpe_file, kinds, None).dots} == {"hos", "gp", "pha", "col"}


def test_dots_are_in_a_stable_order(bpe_file: Path) -> None:
    kinds = load_kinds()
    ids = [k.id for k in kinds]
    order = [ids.index(d.kind) for d in read_places(bpe_file, kinds, None).dots]
    assert order == sorted(order)


def test_kinds_are_a_consistent_contract() -> None:
    kinds = load_kinds()
    assert len({k.id for k in kinds}) == len(kinds)
    codes = [code for k in kinds for code in k.bpe]
    assert len(set(codes)) == len(codes), "a BPE code belongs to one kind only"
    assert all(5 <= k.minzoom <= 12 for k in kinds), "places are tiled from z5 to z12"
    assert {k.family for k in kinds} == {"health", "education", "daily", "leisure"}


def test_kinds_match_the_app_catalogue() -> None:
    if not APP_CATALOGUE.exists():
        pytest.skip("the app catalogue is not in this checkout")
    declared = re.findall(r"\{ id: '(\w+)', family: '(\w+)', minZoom: (\d+) \}", APP_CATALOGUE.read_text(encoding="utf-8"))
    rows = json.loads(KINDS_FILE.read_text(encoding="utf-8"))["places"]
    assert declared == [(row["id"], row["family"], str(row["minzoom"])) for row in rows]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("ECOLE ELEMENTAIRE PUBLIQUE JEAN JAURES", "École Élémentaire Publique Jean Jaurès"),
        ("COLLEGE DU PARC", "Collège du Parc"),
        ("LYCEE POLYVALENT D'ARSONVAL", "Lycée Polyvalent d'Arsonval"),
        ("L'ECOLE DE LA RIVIERE", "L'École de la Riviere"),
        ("LA BIBLIOTHEQUE", "La Bibliothèque"),
        ("BIBLIOTHÈQUE MUNICIPALE", "Bibliothèque Municipale"),
        ("BOULOGNE-SUR-MER BP", "Boulogne-sur-Mer BP"),
        ("CHU DE NANTES", "CHU de Nantes"),
        ("SAINT ETIENNE", "Saint Étienne"),
        ("LOUIS XIV", "Louis XIV"),
        ("ECOLE 2D DEGRE", "École 2D Degré"),
        ("  MEDIATHEQUE   ET  CINEMA ", "Médiathèque et Cinéma"),
    ],
)
def test_names_are_title_case_with_french_small_words_and_a_few_accents(raw: str, expected: str) -> None:
    assert names.normalise_name(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "   ", "_Z", "_U", "123", "--"])
def test_a_missing_or_placeholder_name_is_no_name(raw: str | None) -> None:
    assert names.normalise_name(raw) is None


def test_a_long_name_is_cut_on_a_word_within_the_cap() -> None:
    long = "ECOLE ELEMENTAIRE PUBLIQUE " + " ".join(["PIERRE"] * 20)
    cut = names.normalise_name(long)
    assert cut is not None
    assert len(cut) <= names.MAX_NAME_CHARS
    assert cut.endswith("Pierre…")
    assert names.normalise_name("A" * 100) == "A" + "a" * (names.MAX_NAME_CHARS - 2) + "…"
