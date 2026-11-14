"""Isolines of a commune-level class: the lines across which the value rises to level n.

For each level n, the boundary of the union of the communes whose value is n or more, minus the stretches that follow
the outline of the communes that have a value at all (coast, national border, department edge of a slice, and any
commune whose value is unknown). Those are not changes of value: a line there would either duplicate the coastline the
map already draws or imply "lower class" across ground nobody measured.

Seismic zones and the commune risks (flood, clay, radon, cavities) are all drawn this way.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString
from shapely.geometry.base import BaseGeometry

from settling.boundaries import Area

# Lines within this distance of the outline follow it. Wider than the slivers between neighbouring generalised
# communes, narrower than one pixel at the last zoom the lines are tiled for (about 50 m at z10).
OUTLINE_MARGIN_M = 30.0
# A tile feature is copied into every tile its bounding box touches: long lines are cut so a part stays tile-sized.
MAX_PART_M = 25_000.0

_TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
_FROM_L93 = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)


@dataclass(frozen=True)
class IsoLine:
    level: int  # the level the value rises to, across the line
    geometry: LineString  # WGS84
    length_m: float  # Lambert-93 metres


@dataclass(frozen=True)
class IsoLines:
    parts: list[IsoLine]  # lines of at most about MAX_PART_M, for the tiler
    lines: dict[int, int]  # level -> number of whole lines
    length_m: dict[int, float]  # level -> total length


def isolines(communes: list[Area], values: dict[str, int], levels: Sequence[int]) -> IsoLines:
    """Isolines of the communes that have a value; a commune without one is treated as outside, so it draws none.

    `levels` is ascending. A level gets lines when some commune has a value from that level up to the next one (for
    the last level, from it up): a level between two values nobody has would repeat the line of the next level.
    """
    known = [a for a in communes if a.code in values]
    geometries = _transform([a.geometry for a in known], _TO_L93)
    classes = np.array([values[a.code] for a in known])
    interior = shapely.union_all(geometries).buffer(-OUTLINE_MARGIN_M)
    pieces: list[tuple[int, LineString]] = []
    lines: dict[int, int] = {}
    length_m: dict[int, float] = {}
    for level, ceiling in zip(levels, [*levels[1:], np.inf]):
        if not np.any((classes >= level) & (classes < ceiling)):
            continue
        edge = shapely.boundary(shapely.union_all(geometries[classes >= level]))
        whole = _merged_lines(edge.intersection(interior))
        lines[level] = len(whole)
        length_m[level] = float(sum(line.length for line in whole))
        pieces += [(level, piece) for line in whole for piece in _cut(line)]
    wgs84 = _transform([piece for _, piece in pieces], _FROM_L93)
    parts = [IsoLine(level, line, piece.length) for (level, piece), line in zip(pieces, wgs84)]
    return IsoLines(parts, lines, length_m)


def _merged_lines(geometry: BaseGeometry) -> list[LineString]:
    """The lines of an overlay result, which can be a collection with stray points, joined end to end."""
    lines = [g for g in shapely.get_parts(shapely.get_parts(geometry)) if g.geom_type == "LineString" and not g.is_empty]
    if not lines:
        return []
    return [line for line in shapely.get_parts(shapely.line_merge(MultiLineString(lines))) if line.length > 0]


def _cut(line: LineString) -> list[LineString]:
    """Consecutive pieces of the line, each ending at a vertex once it is at least MAX_PART_M long."""
    coords = np.asarray(line.coords)
    steps = np.hypot(*np.diff(coords, axis=0).T)
    pieces, start, travelled = [], 0, 0.0
    for i, step in enumerate(steps, start=1):
        travelled += step
        if travelled >= MAX_PART_M and i < len(coords) - 1:
            pieces.append(LineString(coords[start:i + 1]))
            start, travelled = i, 0.0
    pieces.append(LineString(coords[start:]))
    return pieces


def _transform(geometries: list[BaseGeometry], transformer: Transformer) -> np.ndarray:
    def project(coords: np.ndarray) -> np.ndarray:
        x, y = transformer.transform(coords[:, 0], coords[:, 1])
        return np.column_stack((x, y))

    return shapely.transform(np.asarray(geometries, dtype=object), project)
