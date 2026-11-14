"""Plausibility gate for a built overlays.pmtiles; exits non-zero when the data looks wrong.

usage: python pipeline/check_overlays.py data/build/overlays-national/overlays.pmtiles
       python pipeline/check_overlays.py data/build/slice-p3/overlays.pmtiles --slice

--slice is for a department build: no national ranges, and a missing layer is allowed. Everything about the
structure (kinds, names, positions, zones, risk ids and levels, tile sizes) is checked either way.

Run before publishing so that a broken source file can never reach the live site.
"""

from __future__ import annotations

import argparse
import gzip
import math
import sys
from collections import Counter
from pathlib import Path

import mapbox_vector_tile
from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import Compression, TileType

from settling.overlays.names import MAX_NAME_CHARS
from settling.overlays.places import load_kinds
from settling.overlays.risk_lines import RISKS
from settling.tiles import EXTENT, MERCATOR_HALF_WORLD, tile_bounds

PLACES_MAX_ZOOM = 12  # every dot of every kind is in the tiles of this zoom, and counted there
# Metropolitan France and Corsica with a margin: Ouessant -5.15, Corsica 9.56 east, 41.33 south, Dunkerque 51.09 north.
LON_RANGE = (-5.5, 9.8)
LAT_RANGE = (41.2, 51.3)
# Gzipped bytes. Measured on the national build of 2026-11-13: the largest tile is z10 over central Paris, 195 KB
# for places and 7 KB for seismic lines. The cap leaves a factor of 2 and stays far under the 1.85 MB communes tile.
MAX_TILE_BYTES = 400_000
SEISMIC_ZONES = range(2, 6)
# Metropolitan zoning has zones 1 to 4, so the levels 2, 3 and 4 must each have a line.
NATIONAL_SEISMIC_LEVELS = (2, 3, 4)
# Dots per kind in the national build of 2026-11-13 from data/raw/bpe/BPE25.parquet (BPE 2025, page release
# 2026-11-02, sha256 3bad0dc8b02e...): `python -m settling.overlays --only places`, report `layers.places.kinds`.
# Dots, not rows: same-kind rows at one position are one dot. The range is -15% / +25% around each count, because
# INSEE refreshes the file monthly and a count that falls or jumps more than that means the source or the rules broke.
NATIONAL_DOTS = {
    "hos": 1465, "gp": 30019, "pha": 19598, "den": 21056, "cre": 17481, "mat": 12068, "pri": 34835, "col": 7244,
    "lyc": 4725, "uni": 1260, "sup": 14189, "bak": 44022, "pos": 16602, "sta": 2938, "pool": 3517, "cin": 1943,
    "lib": 15400,
}
DOT_COUNT_RANGES = {kind: (math.floor(0.85 * n), math.ceil(1.25 * n)) for kind, n in NATIONAL_DOTS.items()}
PLACE_PROPERTIES = {"k", "n", "c", "a"}
RISK_PROPERTIES = {"r", "z"}


def check(path: Path, national: bool) -> list[str]:
    problems: list[str] = []
    try:
        scan = _scan(path, problems)
    except Exception as error:  # a damaged archive can fail anywhere in the readers
        return [f"{path.name} is unreadable: {type(error).__name__}: {error}"]
    for layer in ("places", "seismic", "risk"):
        if national and not scan.features[layer]:
            problems.append(f"no {layer} feature in the archive")
    if national:
        problems += _check_national(scan)
    summary = {kind: scan.dots[kind] for kind in sorted(scan.dots)}
    print(f"tiles={scan.tiles} largest_tile={scan.largest_tile} places={sum(scan.dots.values())} dots={summary}")
    print(f"seismic features by zone={dict(sorted(scan.seismic.items()))}")
    print(f"risk features by id and level={dict(sorted(scan.risk.items()))}")
    return problems + scan.problems


class _Scan:
    def __init__(self) -> None:
        self.tiles = 0
        self.largest_tile = 0
        self.dots: Counter[str] = Counter()  # at PLACES_MAX_ZOOM, by kind
        self.seismic: Counter[int] = Counter()  # features by zone, whatever the zoom
        self.risk: Counter[tuple[str, int]] = Counter()  # features by (overlay id, level), whatever the zoom
        self.features: dict[str, int] = {"places": 0, "seismic": 0, "risk": 0}
        self.problems: list[str] = []

    def add(self, problem: str) -> None:
        if len(self.problems) < 30:  # one broken rule would otherwise print a line per dot
            self.problems.append(problem)


def _scan(path: Path, problems: list[str]) -> _Scan:
    scan = _Scan()
    kinds = {kind.id: kind for kind in load_kinds()}
    with path.open("rb") as handle:
        get_bytes = MmapSource(handle)
        header = Reader(get_bytes).header()
        if header["tile_type"] != TileType.MVT or header["tile_compression"] != Compression.GZIP:
            problems.append(f"expected gzip MVT tiles, header says {header['tile_type']}/{header['tile_compression']}")
        for (z, x, y), data in all_tiles(get_bytes):
            scan.tiles += 1
            scan.largest_tile = max(scan.largest_tile, len(data))
            if len(data) > MAX_TILE_BYTES:
                scan.add(f"tile z{z}/{x}/{y} is {len(data)} bytes gzipped (cap {MAX_TILE_BYTES})")
            decoded = mapbox_vector_tile.decode(gzip.decompress(data), default_options={"y_coord_down": True})
            for layer, content in decoded.items():
                for feature in content["features"]:
                    if layer == "places":
                        _check_dot(scan, kinds, (z, x, y), feature)
                    elif layer == "seismic":
                        _check_line(scan, (z, x, y), feature)
                    elif layer == "risk":
                        _check_risk_line(scan, (z, x, y), feature)
                    else:
                        scan.add(f"unknown layer {layer!r} in tile z{z}/{x}/{y}")
    return scan


def _check_dot(scan: _Scan, kinds: dict, tile: tuple[int, int, int], feature: dict) -> None:
    scan.features["places"] += 1
    z, x, y = tile
    properties = feature["properties"]
    where = f"z{z}/{x}/{y}"
    if feature["geometry"]["type"] != "Point":
        scan.add(f"a place in tile {where} is a {feature['geometry']['type']}, not a Point")
        return
    kind = kinds.get(properties.get("k"))
    if kind is None:
        scan.add(f"unknown kind id {properties.get('k')!r} in tile {where}")
        return
    if set(properties) - PLACE_PROPERTIES:
        scan.add(f"{kind.id}: unexpected properties {sorted(set(properties) - PLACE_PROPERTIES)} in tile {where}")
    if "n" in properties and not kind.named:
        scan.add(f"{kind.id} is not a named kind but a dot carries the name {properties['n']!r} (tile {where})")
    if "n" in properties and not (isinstance(properties["n"], str) and 0 < len(properties["n"]) <= MAX_NAME_CHARS):
        scan.add(f"{kind.id}: name {properties['n']!r} is empty or over {MAX_NAME_CHARS} characters (tile {where})")
    if "c" in properties and not (isinstance(properties["c"], int) and properties["c"] >= 2):
        scan.add(f"{kind.id}: count {properties['c']!r} must be an integer of 2 or more (tile {where})")
    if "a" in properties and properties["a"] != 1:
        scan.add(f"{kind.id}: approximate flag {properties['a']!r} must be 1 (tile {where})")
    if z < kind.minzoom:
        scan.add(f"{kind.id} is in tile {where}, below its minzoom {kind.minzoom}")
    px, py = feature["geometry"]["coordinates"]
    lon, lat = _lonlat(tile, px, py)
    if not (LON_RANGE[0] <= lon <= LON_RANGE[1] and LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
        scan.add(f"{kind.id} at lon {lon:.4f} lat {lat:.4f} is outside metropolitan France (tile {where})")
    # a dot inside the buffer of a neighbouring tile is counted once, in the tile that owns it
    if z == PLACES_MAX_ZOOM and 0 <= px < EXTENT and 0 <= py < EXTENT:
        scan.dots[kind.id] += 1


def _check_line(scan: _Scan, tile: tuple[int, int, int], feature: dict) -> None:
    scan.features["seismic"] += 1
    zone = feature["properties"].get("z")
    if zone not in SEISMIC_ZONES:
        scan.add(f"seismic line with zone {zone!r} in tile z{tile[0]}/{tile[1]}/{tile[2]} (expected 2 to 5)")
        return
    scan.seismic[zone] += 1
    if feature["geometry"]["type"] not in ("LineString", "MultiLineString"):
        scan.add(f"a seismic feature in tile z{tile[0]}/{tile[1]}/{tile[2]} is a {feature['geometry']['type']}")


def _check_risk_line(scan: _Scan, tile: tuple[int, int, int], feature: dict) -> None:
    scan.features["risk"] += 1
    properties = feature["properties"]
    where = f"z{tile[0]}/{tile[1]}/{tile[2]}"
    risk, level = properties.get("r"), properties.get("z")
    if set(properties) != RISK_PROPERTIES:
        scan.add(f"risk line with properties {sorted(properties)} in tile {where} (expected {sorted(RISK_PROPERTIES)})")
    elif risk not in RISKS:
        scan.add(f"risk line with unknown overlay id {risk!r} in tile {where} (known: {sorted(RISKS)})")
    elif level not in RISKS[risk].levels:
        scan.add(f"{risk} line with level {level!r} in tile {where} (expected one of {RISKS[risk].levels})")
    else:
        scan.risk[(risk, level)] += 1
    if feature["geometry"]["type"] not in ("LineString", "MultiLineString"):
        scan.add(f"a risk feature in tile {where} is a {feature['geometry']['type']}")


def _check_national(scan: _Scan) -> list[str]:
    problems = []
    for kind in load_kinds():
        low, high = DOT_COUNT_RANGES.get(kind.id, (1, math.inf))
        if scan.dots[kind.id] == 0:
            problems.append(f"kind {kind.id} is missing from the places")
        elif not low <= scan.dots[kind.id] <= high:
            problems.append(f"kind {kind.id} has {scan.dots[kind.id]} dots (expected {low} to {high})")
    problems += [f"no seismic line for zone {zone}" for zone in NATIONAL_SEISMIC_LEVELS if not scan.seismic[zone]]
    for risk, definition in RISKS.items():
        lowest = definition.levels[0]
        if not scan.risk[(risk, lowest)]:
            problems.append(f"no {risk} line at its lowest level {lowest}: check {definition.property} in the communes archive")
    return problems


def _lonlat(tile: tuple[int, int, int], px: float, py: float) -> tuple[float, float]:
    minx, _miny, maxx, maxy = tile_bounds(*tile)
    mercator_x = minx + px * (maxx - minx) / EXTENT
    mercator_y = maxy - py * (maxx - minx) / EXTENT
    lon = mercator_x / MERCATOR_HALF_WORLD * 180
    lat = math.degrees(2 * math.atan(math.exp(mercator_y / MERCATOR_HALF_WORLD * math.pi)) - math.pi / 2)
    return lon, lat


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("path", type=Path)
    parser.add_argument("--slice", action="store_true", help="a department build: skip the national ranges")
    arguments = parser.parse_args()
    issues = check(arguments.path, national=not arguments.slice)
    for issue in issues:
        print("FAIL:", issue)
    sys.exit(1 if issues else 0)
