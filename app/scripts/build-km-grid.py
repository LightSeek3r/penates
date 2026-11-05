"""Writes src/map/km-grid.json: the Lambert-93 (EPSG:2154) kilometre grid as WGS84 lines.

usage: pipeline/.venv/Scripts/python app/scripts/build-km-grid.py

Needs pyproj (dev-only; the generated file is committed). 100 km lines are sampled every 20 km and
10 km lines every 50 km, which keeps the file small while the curvature stays under a pixel.
"""

import json
from pathlib import Path

from pyproj import Transformer

EAST = (50_000, 1_250_000)
NORTH = (6_040_000, 7_150_000)

to_wgs84 = Transformer.from_crs(2154, 4326, always_xy=True)


def line(axis: str, value: int, level: int, sample: int) -> dict:
    if axis == "E":
        points = [to_wgs84.transform(value, n) for n in range(NORTH[0], NORTH[1] + 1, sample)]
    else:
        points = [to_wgs84.transform(e, value) for e in range(EAST[0], EAST[1] + 1, sample)]
    return {
        "type": "Feature",
        "properties": {"level": level},
        "geometry": {"type": "LineString", "coordinates": [[round(x, 4), round(y, 4)] for x, y in points]},
    }


features = []
for level, sample in ((100, 20_000), (10, 50_000)):
    step = level * 1000
    for e in range(-(-EAST[0] // step) * step, EAST[1] + 1, step):
        if level == 10 and e % 100_000 == 0:
            continue
        features.append(line("E", e, level, sample))
    for n in range(-(-NORTH[0] // step) * step, NORTH[1] + 1, step):
        if level == 10 and n % 100_000 == 0:
            continue
        features.append(line("N", n, level, sample))

out = Path(__file__).resolve().parents[1] / "src" / "map" / "km-grid.json"
out.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")), encoding="utf-8")
print(f"{len(features)} lines, {out.stat().st_size / 1024:.0f} KiB -> {out}")
