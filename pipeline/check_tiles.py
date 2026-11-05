"""Plausibility gate for a built communes.pmtiles; exits non-zero when the data looks wrong.

usage: python pipeline/check_tiles.py data/build/national/communes.pmtiles

Run before publishing so that a broken source file can never reach the live site.
"""

from __future__ import annotations

import gzip
import statistics
import sys
from pathlib import Path

import mapbox_vector_tile
from pmtiles.reader import MmapSource, all_tiles

COMMUNE_ZOOM = 8
# The national view (filters must work there): every commune must already exist at this zoom.
COMMUNE_MIN_ZOOM = 4
DEPARTMENT_ZOOM = 3
NO_COVERAGE_DEPARTMENTS = ("57", "67", "68")
PARIS_ARRONDISSEMENTS = {f"751{n:02d}" for n in range(1, 21)}
DISTANCES = ("d_hos", "d_gp", "d_sch", "d_sup", "d_bak", "d_pool")
# Géorisques API v1 zonage_sismique, checked 2026-11-05: Nice 4 (MOYENNE), Paris 1 (TRES FAIBLE),
# Lyon 2 (FAIBLE), Marseille 2 (FAIBLE). Metropolitan France has no zone 5 (Antilles only).
KNOWN_ZONES = {"06088": 4, "69381": 2, "13201": 2, **{code: 1 for code in PARIS_ARRONDISSEMENTS}}


def load_features(get_bytes, zoom: int, layer: str) -> dict[str, dict]:
    """Every feature of `layer` across the tiles of one zoom, keyed by INSEE code."""
    features: dict[str, dict] = {}
    for (z, _x, _y), data in all_tiles(get_bytes):
        if z != zoom:
            continue
        decoded = mapbox_vector_tile.decode(gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data)
        for feature in decoded.get(layer, {}).get("features", []):
            properties = feature["properties"]
            features[str(properties["code"])] = properties
    return features


def check(path: Path) -> list[str]:
    problems: list[str] = []
    with path.open("rb") as handle:
        get_bytes = MmapSource(handle)
        communes = load_features(get_bytes, COMMUNE_ZOOM, "communes")
        national_view = load_features(get_bytes, COMMUNE_MIN_ZOOM, "communes")
        departments = load_features(get_bytes, DEPARTMENT_ZOOM, "departments")

    if len(communes) < 34_000:
        problems.append(f"only {len(communes)} communes at z{COMMUNE_ZOOM} (expected 34,000+)")
    if len(departments) < 90:
        problems.append(f"only {len(departments)} departments at z{DEPARTMENT_ZOOM} (expected 90+)")

    priced = [c for c in communes.values() if "p_all" in c]
    if len(priced) < 0.9 * len(communes):
        problems.append(f"only {len(priced)} of {len(communes)} communes have a price")

    paris = [communes[code]["p_all"] for code in PARIS_ARRONDISSEMENTS if code in communes and "p_all" in communes[code]]
    if len(paris) != 20 or not all(7_000 <= price <= 16_000 for price in paris):
        problems.append(f"Paris arrondissement medians out of range: {sorted(paris)}")

    creuse = [c["p_all"] for c in communes.values() if str(c["code"]).startswith("23") and "p_all" in c]
    if not creuse or statistics.median(creuse) > 1_500:
        problems.append(f"Creuse median of commune medians is {statistics.median(creuse) if creuse else 'n/a'}")

    for department in NO_COVERAGE_DEPARTMENTS:
        feature = departments.get(department)
        if feature is None or feature.get("c_all") != 4 or "p_all" in feature:
            problems.append(f"department {department} must be no-coverage (c_all=4) without a price: {feature}")

    cheap_big = [c for c in priced if c.get("n_all", 0) >= 30 and c["p_all"] < 300]
    if cheap_big:
        problems.append(f"{len(cheap_big)} well-sampled communes priced under 300 EUR/m2")

    if set(national_view) != set(communes):
        problems.append(f"{len(set(communes) - set(national_view))} communes missing at z{COMMUNE_MIN_ZOOM}")
    problems += check_indicators(communes)

    print(f"communes={len(communes)} priced={len(priced)} departments={len(departments)} paris={sorted(paris)[:1]}..{sorted(paris)[-1:]}")
    return problems


def check_indicators(communes: dict[str, dict]) -> list[str]:
    problems: list[str] = []
    zones = [c.get("sz") for c in communes.values()]
    if any(z not in (1, 2, 3, 4) for z in zones):
        problems.append(f"seismic zone missing or outside 1..4 for {sum(z not in (1, 2, 3, 4) for z in zones)} communes")
    wrong = {code: communes[code].get("sz") for code, zone in KNOWN_ZONES.items() if communes.get(code, {}).get("sz") != zone}
    if wrong:
        problems.append(f"seismic zones differ from Géorisques: {wrong}")

    for prop in DISTANCES:
        values = [c.get(prop) for c in communes.values()]
        if any(not isinstance(v, int) or v < 0 or v % 100 for v in values):
            problems.append(f"{prop}: missing, negative or unrounded values")
            continue
        if max(values) > 100_000:
            problems.append(f"{prop}: a commune is {max(values)} m from the nearest equipment")
    if problems:
        return problems

    calvi = communes.get("2B050", {}).get("d_hos")
    if calvi is None or calvi > 5_000:
        problems.append(f"Calvi (2B050) is {calvi} m from a hospital (CH Calvi is in the commune)")
    paris_hospital = [communes[code]["d_hos"] for code in PARIS_ARRONDISSEMENTS if code in communes]
    if len(paris_hospital) != 20 or max(paris_hospital) > 3_000:
        problems.append(f"Paris arrondissements farther than 3 km from a hospital: {sorted(paris_hospital)}")
    if not any(c["d_hos"] > 20_000 for c in communes.values()):
        problems.append("no commune is more than 20 km from a hospital")
    median_gp = statistics.median(c["d_gp"] for c in communes.values())
    if not 1_000 <= median_gp <= 6_000:
        problems.append(f"median distance to a GP is {median_gp} m (expected 1-6 km)")
    for prop in ("d_sch", "d_bak"):
        median = statistics.median(c[prop] for c in communes.values())
        if median > statistics.median(c["d_hos"] for c in communes.values()):
            problems.append(f"median {prop} ({median} m) above the median distance to a hospital")
    print("median distances:", {p: statistics.median(c[p] for c in communes.values()) for p in DISTANCES})
    return problems


if __name__ == "__main__":
    issues = check(Path(sys.argv[1]))
    for issue in issues:
        print("FAIL:", issue)
    sys.exit(1 if issues else 0)
