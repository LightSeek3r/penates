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
DEPARTMENT_ZOOM = 3
NO_COVERAGE_DEPARTMENTS = ("57", "67", "68")
PARIS_ARRONDISSEMENTS = {f"751{n:02d}" for n in range(1, 21)}


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

    print(f"communes={len(communes)} priced={len(priced)} departments={len(departments)} paris={sorted(paris)[:1]}..{sorted(paris)[-1:]}")
    return problems


if __name__ == "__main__":
    issues = check(Path(sys.argv[1]))
    for issue in issues:
        print("FAIL:", issue)
    sys.exit(1 if issues else 0)
