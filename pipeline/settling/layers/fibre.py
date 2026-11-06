"""Share of premises eligible to fibre to the home (`fb`, FttH, integer %) per tile commune, from ARCEP.

Source: ARCEP "Ma connexion internet" (MCI) open data, communal statistics by technology
(`statistiques/<quarter>/commune/commune_techno.csv`), Licence Ouverte 2.0. Per commune it gives `nbr`, the
premises ("locaux": dwellings plus business premises, `type == "all"`) of ARCEP's building base, and
`elig_ftth`, those of them eligible to FttH. A premises is eligible when its building is shown on Ma
connexion internet with fibre available from the operators' declarations to ARCEP (ARCEP's statistics count
eligibility where a commercial offer is available). Eligible is not subscribed, and not a promise of a
speed or of a free connection: the last drop to the home may still have to be built ("raccordement").

    fb = elig_ftth / nbr, rounded half up to an integer percent, except that 0 and 100 are kept for
    "none" and "every premises": a rounded 0 or 100 that is not exact becomes 1 or 99.

Joins (MCI uses the current commune codes, checked against ADMIN EXPRESS 2026: every metropolitan commune
is present):
  - Paris, Lyon and Marseille: MCI publishes only the parent communes (75056, 69123, 13055), while the
    tiles have the 45 municipal arrondissements, which differ widely (Marseille 1er 53 %, city 90 %). Each
    arrondissement takes the ratio of ARCEP's other FttH publication of the same quarter, the deployment
    observatory (cartefibre, "<quarter>-Commune" file, Licence Ouverte): FttH-connectable premises
    ("locaux raccordables") over ARCEP's estimate of premises. The city totals of the two publications agree
    within 0.4 point (checked in the report). The observatory is not used elsewhere because it caps the
    connectable count at the premises estimate: 38 % of its communes show exactly 100 %.
  - a tile commune whose former communes (merged after the source's geography) are still separate rows
    takes their summed counts;
  - a commune with no premises in the source (0 locaux: villages "morts pour la France", communes
    restored after a merger whose premises are still counted in the former merged commune) stays absent.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import statistics
import struct
import zipfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from settling.layers import Layer, LayerContext, LayerResult, Properties
from settling.seismic import PLM_PARENTS, plm_parent
from settling.sources import SourceError, download

NAME = "fibre"
LICENCE = "Licence Ouverte / Open Licence 2.0 (Etalab)"

# Pinned quarter, the latest published on 2026-11-06 (MCI files dated 2026-09-14, observatory 2026-09-10).
# Moving to a newer quarter is a deliberate change: update the URLs, sizes, checksums and SPOT_CHECKS.
QUARTER = "2026_T2"  # data at 2026-06-30

MCI_DATASET_PAGE = "https://www.data.gouv.fr/datasets/ma-connexion-internet"
MCI_FILE = "commune_techno.csv"
MCI_URL = f"https://data.arcep.fr/fixe/maconnexioninternet/statistiques/{QUARTER}/commune/{MCI_FILE}"
MCI_BYTES = 2_262_503
MCI_SHA1 = "1cfce5dd433c0bb5759ef26f202f4dd892a96ad9"
MCI_TYPE = "all"  # dwellings plus business premises; the only type published at commune level

OBSERVATORY_DATASET_PAGE = "https://www.data.gouv.fr/datasets/le-marche-du-haut-et-tres-haut-debit-fixe-deploiements"
OBSERVATORY_FILE = "observatoire-commune.zip"
OBSERVATORY_URL = (
    "https://static.data.gouv.fr/resources/le-marche-du-haut-et-tres-haut-debit-fixe-deploiements/"
    "20260910-162103/2026t2-commune.zip"
)
OBSERVATORY_BYTES = 32_714_735
OBSERVATORY_SHA1 = "8790f2a2b0f759ffc9deb88179d6198af928ccbc"  # as published by data.gouv.fr
OBSERVATORY_COLUMNS = ("INSEE_COM", "Locaux", "ftth")
QUARTER_IN_NAME = re.compile(r"(\d{4})_?T([1-4])", re.IGNORECASE)

OVERRIDE_HINT = f"--layer-file {NAME}=DIR (a directory holding {MCI_FILE} and {OBSERVATORY_FILE})"


@dataclass(frozen=True)
class Premises:
    total: int
    ftth: int

    def __add__(self, other: Premises) -> Premises:
        return Premises(self.total + other.total, self.ftth + other.ftth)


def share(premises: Premises) -> int | None:
    """Integer percent of eligible premises; None when the commune has no premises."""
    if premises.total <= 0:
        return None
    if premises.ftth in (0, premises.total):
        return 100 * premises.ftth // premises.total
    rounded = (200 * premises.ftth + premises.total) // (2 * premises.total)
    return min(99, max(1, rounded))


def quarter_of(date: str) -> str:
    """'2026-06-30' -> '2026_T2'."""
    year, month = date[:4], int(date[5:7])
    return f"{year}_T{(month - 1) // 3 + 1}"


def read_mci(path: Path) -> tuple[str, dict[str, Premises]]:
    """(data date, INSEE code -> premises) from MCI `commune_techno.csv`."""
    counts: dict[str, Premises] = {}
    dates: set[str] = set()
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            if row["type"] != MCI_TYPE:
                continue
            code = row["code_insee"].strip()
            premises = Premises(int(row["nbr"]), int(row["elig_ftth"]))
            if not 0 <= premises.ftth <= premises.total:
                raise SourceError(f"{path}: {code} has {premises.ftth} FttH-eligible of {premises.total} premises")
            if code in counts:
                raise SourceError(f"{path}: duplicate commune {code}")
            counts[code] = premises
            dates.add(row["date"].strip())
    if len(dates) != 1:
        raise SourceError(f"{path}: expected one data date, found {sorted(dates)}")
    return dates.pop(), counts


def read_dbf(data: bytes, columns: tuple[str, ...]) -> list[dict[str, str]]:
    """The given text/number columns of a dBase III table (shapefile attributes), as stripped strings."""
    count, header_bytes, record_bytes = struct.unpack_from("<IHH", data, 4)
    fields: dict[str, tuple[int, int]] = {}
    offset, pos = 1, 32  # each record starts with a one-byte deletion flag
    while data[pos] != 0x0D:
        name = data[pos:pos + 11].split(b"\0", 1)[0].decode("latin-1")
        length = data[pos + 16]
        fields[name] = (offset, length)
        offset += length
        pos += 32
    missing = set(columns) - fields.keys()
    if missing:
        raise SourceError(f"attribute table lacks columns {sorted(missing)}")
    rows = []
    for index in range(count):
        start = header_bytes + index * record_bytes
        if data[start:start + 1] == b"*":
            continue
        rows.append({
            name: data[start + fields[name][0]:start + fields[name][0] + fields[name][1]].decode("utf-8").strip()
            for name in columns
        })
    return rows


def read_observatory_arrondissements(path: Path) -> tuple[str, dict[str, Premises]]:
    """(quarter, arrondissement code -> premises) from the observatory's commune shapefile zip."""
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".dbf")]
        if len(names) != 1:
            raise SourceError(f"{path}: expected one .dbf, found {names}")
        match = QUARTER_IN_NAME.search(names[0])
        if match is None:
            raise SourceError(f"{path}: no quarter in {names[0]}")
        rows = read_dbf(archive.read(names[0]), OBSERVATORY_COLUMNS)
    counts: dict[str, Premises] = {}
    for row in rows:
        code = row["INSEE_COM"]
        if plm_parent(code) is None:
            continue
        premises = Premises(round(float(row["Locaux"] or 0)), round(float(row["ftth"] or 0)))
        if not 0 <= premises.ftth <= premises.total:
            raise SourceError(f"{path}: {code} has {premises.ftth} FttH-connectable of {premises.total} premises")
        counts[code] = premises
    return f"{match[1]}_T{match[2]}", counts


@dataclass(frozen=True)
class Assignment:
    shares: dict[str, int]
    by_method: dict[str, int]
    from_former_communes: list[dict]
    no_premises: list[str]
    missing: list[str]


def assign_shares(
    codes: list[str], mci: dict[str, Premises], arrondissements: dict[str, Premises], merged_codes: dict[str, str]
) -> Assignment:
    tile_codes = set(codes)
    former: dict[str, list[str]] = {}
    for old, new in merged_codes.items():
        if old not in tile_codes:
            former.setdefault(new, []).append(old)
    shares: dict[str, int] = {}
    methods: Counter[str] = Counter()
    via_former: list[dict] = []
    no_premises: list[str] = []
    missing: list[str] = []
    for code in codes:
        if plm_parent(code) is not None:
            found, method = ([code] if code in arrondissements else []), "plm_observatory"
            source = arrondissements
        else:
            found = [c for c in (code, *sorted(former.get(code, []))) if c in mci]
            method = "own_code" if found == [code] else "former_communes"
            source = mci
        if not found:
            missing.append(code)
            continue
        premises = sum((source[c] for c in found), Premises(0, 0))
        value = share(premises)
        if value is None:
            no_premises.append(code)
            continue
        shares[code] = value
        methods[method] += 1
        if method == "former_communes":
            via_former.append({"code": code, "fb": value, "from": found})
    return Assignment(shares, dict(sorted(methods.items())), via_former, no_premises, missing)


def plm_cross_check(mci: dict[str, Premises], arrondissements: dict[str, Premises]) -> dict[str, dict]:
    """City-wide share by MCI (parent row) next to the observatory's arrondissements summed."""
    checks = {}
    for prefix, parent in PLM_PARENTS.items():
        parts = [p for code, p in arrondissements.items() if code.startswith(prefix)]
        if parent in mci and parts:
            checks[parent] = {"mci": share(mci[parent]), "observatory": share(sum(parts, Premises(0, 0))),
                              "arrondissements": len(parts)}
    return checks


def quantiles(values: list[int]) -> dict[str, float]:
    if len(values) < 2:
        return {}
    cuts = statistics.quantiles(values, n=20, method="inclusive")
    return {"min": min(values), "p5": cuts[0], "p25": cuts[4], "p50": cuts[9], "p75": cuts[14], "p95": cuts[18],
            "max": max(values)}


def compute(ctx: LayerContext) -> LayerResult:
    mci_path, observatory_path = _source_files(ctx)
    mci_date, mci = read_mci(mci_path)
    mci_quarter = quarter_of(mci_date)
    observatory_quarter, arrondissements = read_observatory_arrondissements(observatory_path)
    if mci_quarter != observatory_quarter:
        raise SourceError(f"MCI quarter {mci_quarter} differs from observatory quarter {observatory_quarter}")
    codes = ctx.codes
    result = assign_shares(codes, mci, arrondissements, ctx.merged_codes)
    values = list(result.shares.values())
    source = {
        "quarter": mci_quarter,
        "data_date": mci_date,
        "licence": LICENCE,
        "attribution": "Arcep, Ma connexion internet; Arcep, observatoire des déploiements FttH (cartefibre)",
        "mci": {"dataset": MCI_DATASET_PAGE, "url": MCI_URL, "file": MCI_FILE, "columns": ["nbr", "elig_ftth"],
                "type": MCI_TYPE, "sha256": _sha256(mci_path)},
        "observatory": {"dataset": OBSERVATORY_DATASET_PAGE, "url": OBSERVATORY_URL,
                        "columns": ["Locaux", "ftth"], "used_for": "Paris, Lyon, Marseille arrondissements",
                        "sha256": _sha256(observatory_path)},
    }
    report = {
        "quarter": mci_quarter,
        "communes": len(codes),
        "present": len(values),
        "coverage": round(len(values) / (len(codes) or 1), 4),
        "by_method": result.by_method,
        "quantiles": quantiles(values),
        "at_100": sum(v == 100 for v in values),
        "below_50": sum(v < 50 for v in values),
        "at_0": sum(v == 0 for v in values),
        "plm_city_check": plm_cross_check(mci, arrondissements),
        "from_former_communes": result.from_former_communes[:50],
        "no_premises": result.no_premises,
        "missing": result.missing[:50],
    }
    return LayerResult({code: {"fb": value} for code, value in result.shares.items()}, source, report)


def _source_files(ctx: LayerContext) -> tuple[Path, Path]:
    override = ctx.overrides.get(NAME)
    if override is not None:
        return override / MCI_FILE, override / OBSERVATORY_FILE
    folder = ctx.raw / NAME / QUARTER
    mci_path, observatory_path = folder / MCI_FILE, folder / OBSERVATORY_FILE
    download(ctx.session, MCI_URL, mci_path, MCI_BYTES, MCI_SHA1, override_flag=OVERRIDE_HINT)
    download(ctx.session, OBSERVATORY_URL, observatory_path, OBSERVATORY_BYTES, OBSERVATORY_SHA1,
             override_flag=OVERRIDE_HINT)
    return mci_path, observatory_path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# Verified by hand in the 2026_T2 files (premises eligible / premises -> fb).
SPOT_CHECKS = {
    "75101": 91,  # Paris 1er, observatory 22,660 / 24,814
    "75119": 93,  # Paris 19e, observatory 112,391 / 120,694
    "13201": 53,  # Marseille 1er, observatory 17,094 / 31,959
    "69381": 97,  # Lyon 1er, observatory 23,883 / 24,565
    "23096": 96,  # Guéret, MCI 9,965 / 10,373
    "69264": 99,  # Villefranche-sur-Saône, MCI 25,672 / 25,828
    "84007": 83,  # Avignon, MCI
    "69035": 70,  # Cenves (rural Beaujolais), MCI 198 / 283
    "23191": 4,  # Saint-Éloi (rural Creuse), MCI 6 / 166
    "68185": 0,  # Lièpvre, MCI 0 / 998: a measured 0, not a missing value
}
MUST_BE_ABSENT = ("55050", "15171")  # 0 premises in MCI: Bezonvaux (dead village), Sainte-Anastasie (restored 2025)
PARIS_RANGE = (85, 100)  # 2026_T2 arrondissements: 91..99
NATIONAL_MEDIAN = (90, 100)  # 2026_T2 metropole: 97
NATIONAL_MIN_COMMUNES = 30_000


def gate(communes: dict[str, dict]) -> list[str]:
    """Spot checks against the pinned quarter (skipped for communes not built) and national plausibility."""
    problems = []
    for code, expected in SPOT_CHECKS.items():
        if code in communes and communes[code].get("fb") != expected:
            problems.append(f"{code}: fb {communes[code].get('fb')} != {expected} (ARCEP {QUARTER})")
    for code in MUST_BE_ABSENT:
        if "fb" in communes.get(code, {}):
            problems.append(f"{code} has no premises in the source and must not publish fb")
    paris = [p["fb"] for c, p in communes.items() if c.startswith("751") and "fb" in p]
    if paris and not all(PARIS_RANGE[0] <= v <= PARIS_RANGE[1] for v in paris):
        problems.append(f"Paris arrondissements fb outside {PARIS_RANGE}: {sorted(paris)}")
    values = [p["fb"] for p in communes.values() if "fb" in p]
    if len(values) >= NATIONAL_MIN_COMMUNES:
        median = statistics.median(values)
        if not NATIONAL_MEDIAN[0] <= median <= NATIONAL_MEDIAN[1]:
            problems.append(f"national median fb {median} outside {NATIONAL_MEDIAN}")
        if sum(v < 50 for v in values) < 0.005 * len(values):
            problems.append("fewer than 0.5% of communes below 50% FttH: rural gaps disappeared, check the source")
    return problems


LAYER = Layer(
    name=NAME,
    fields={
        "fb": f"Share % of premises (dwellings and business premises) eligible to fibre to the home (FttH), "
              f"ARCEP Ma connexion internet {QUARTER}; Paris/Lyon/Marseille arrondissements: ARCEP FttH "
              f"observatory, connectable premises. Eligible, not subscribed, no speed guarantee",
    },
    compute=compute,
    ranges={"fb": (0, 100)},
    # 2026_T2 metropole: 34,781 of 34,788 tile communes (7 have no premises in the source).
    min_coverage={"fb": 0.99},
    gate=gate,
)
