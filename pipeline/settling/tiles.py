"""Pure-Python vector tiler: shapely polygons -> gzipped MVT tiles -> one PMTiles archive."""

from __future__ import annotations

import gzip
import math
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import mapbox_vector_tile
import numpy as np
import shapely
from mapbox_vector_tile.encoder import on_invalid_geometry_make_valid
from pmtiles.tile import Compression, TileType, tileid_to_zxy, zxy_to_tileid
from pmtiles.writer import Writer
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

EXTENT = 4096
BUFFER_UNITS = 64
# Douglas-Peucker tolerance in tile units at each zoom. Neighbours are simplified independently, so
# shared borders can drift by up to this much: at 1 unit (1/8 px on a 512 px tile) gaps stay invisible.
SIMPLIFY_UNITS = 1.0
MERCATOR_HALF_WORLD = 20037508.342789244
WORLD = 2 * MERCATOR_HALF_WORLD
MAX_LATITUDE = 85.0511287798066

Properties = dict[str, int | str]


@dataclass(frozen=True)
class TileFeature:
    fid: int
    properties: Properties
    geometry: BaseGeometry  # Web Mercator metres


@dataclass(frozen=True)
class TileLayer:
    name: str
    minzoom: int
    maxzoom: int
    features: list[TileFeature]


@dataclass(frozen=True)
class TileTask:
    z: int
    x: int
    y: int
    layers: dict[str, list[tuple[int, Properties, BaseGeometry]]]


def to_web_mercator(geometries: list[BaseGeometry]) -> list[BaseGeometry]:
    def project(coords: np.ndarray) -> np.ndarray:
        lon = coords[:, 0]
        lat = np.clip(coords[:, 1], -MAX_LATITUDE, MAX_LATITUDE)
        x = lon * MERCATOR_HALF_WORLD / 180.0
        y = np.log(np.tan((90.0 + lat) * math.pi / 360.0)) * MERCATOR_HALF_WORLD / math.pi
        return np.column_stack((x, y))

    return list(shapely.transform(np.asarray(geometries, dtype=object), project))


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    span = WORLD / (1 << z)
    minx = -MERCATOR_HALF_WORLD + x * span
    maxy = MERCATOR_HALF_WORLD - y * span
    return minx, maxy - span, minx + span, maxy


def build_tiles(layers: list[TileLayer], workers: int) -> dict[int, bytes]:
    """All non-empty tiles of all layers, keyed by PMTiles tile id, gzip-compressed."""
    min_zoom = min(layer.minzoom for layer in layers)
    max_zoom = max(layer.maxzoom for layer in layers)
    tasks = [task for z in range(min_zoom, max_zoom + 1) for task in _zoom_tasks(layers, z)]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        results = pool.map(encode_tile, tasks, chunksize=8)
        return {tile_id: data for tile_id, data in results if data is not None}


def encode_tile(task: TileTask) -> tuple[int, bytes | None]:
    minx, miny, maxx, maxy = tile_bounds(task.z, task.x, task.y)
    scale = EXTENT / (maxx - minx)
    pad = BUFFER_UNITS / scale

    def to_tile_units(coords: np.ndarray) -> np.ndarray:
        return np.column_stack(((coords[:, 0] - minx) * scale, (maxy - coords[:, 1]) * scale))

    encoded_layers = []
    for name, features in task.layers.items():
        geometries = np.asarray([g for _, _, g in features], dtype=object)
        clipped = shapely.clip_by_rect(geometries, minx - pad, miny - pad, maxx + pad, maxy + pad)
        local = shapely.set_precision(shapely.transform(clipped, to_tile_units), 1.0)
        encoded = [
            {"id": fid, "properties": props, "geometry": polygon}
            for (fid, props, _), geometry in zip(features, local)
            if (polygon := _polygonal(geometry)) is not None
        ]
        if encoded:
            encoded_layers.append({"name": name, "features": encoded})
    if not encoded_layers:
        return zxy_to_tileid(task.z, task.x, task.y), None
    data = mapbox_vector_tile.encode(
        encoded_layers,
        default_options={
            "extents": EXTENT,
            "y_coord_down": True,
            "on_invalid_geometry": on_invalid_geometry_make_valid,
        },
    )
    return zxy_to_tileid(task.z, task.x, task.y), gzip.compress(data, mtime=0)


def write_pmtiles(
    path: Path,
    tiles: dict[int, bytes],
    metadata: dict,
    bounds: tuple[float, float, float, float],
    center: tuple[float, float, int],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    zooms = [tileid_to_zxy(tile_id)[0] for tile_id in tiles]
    header = {
        "tile_type": TileType.MVT,
        "tile_compression": Compression.GZIP,
        "min_zoom": min(zooms),
        "max_zoom": max(zooms),
        "min_lon_e7": _e7(bounds[0]),
        "min_lat_e7": _e7(bounds[1]),
        "max_lon_e7": _e7(bounds[2]),
        "max_lat_e7": _e7(bounds[3]),
        "center_lon_e7": _e7(center[0]),
        "center_lat_e7": _e7(center[1]),
        "center_zoom": center[2],
    }
    with path.open("wb") as f:
        writer = Writer(f)
        for tile_id in sorted(tiles):
            writer.write_tile(tile_id, tiles[tile_id])
        writer.finalize(header, metadata)


def _zoom_tasks(layers: list[TileLayer], z: int) -> list[TileTask]:
    span = WORLD / (1 << z)
    tolerance = SIMPLIFY_UNITS * span / EXTENT
    pad = BUFFER_UNITS * span / EXTENT
    per_tile: dict[tuple[int, int], dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for layer in layers:
        if not layer.minzoom <= z <= layer.maxzoom:
            continue
        geometries = np.asarray([f.geometry for f in layer.features], dtype=object)
        simplified = shapely.simplify(geometries, tolerance, preserve_topology=True)
        for feature, geometry, (gx0, gy0, gx1, gy1) in zip(layer.features, simplified, shapely.bounds(simplified)):
            if shapely.is_empty(geometry):
                continue
            # tile x counts from the west edge, tile y from the north edge of the world
            xs = _index_range(MERCATOR_HALF_WORLD + gx0 - pad, MERCATOR_HALF_WORLD + gx1 + pad, span, z)
            ys = _index_range(MERCATOR_HALF_WORLD - gy1 - pad, MERCATOR_HALF_WORLD - gy0 + pad, span, z)
            for x in xs:
                for y in ys:
                    per_tile[(x, y)][layer.name].append((feature.fid, feature.properties, geometry))
    return [TileTask(z, x, y, dict(layers_)) for (x, y), layers_ in sorted(per_tile.items())]


def _index_range(low: float, high: float, span: float, z: int) -> range:
    first = max(0, int(low // span))
    last = min((1 << z) - 1, int(high // span))
    return range(first, last + 1)


def _polygonal(geometry: BaseGeometry) -> Polygon | MultiPolygon | None:
    if geometry is None or geometry.is_empty:
        return None
    if isinstance(geometry, (Polygon, MultiPolygon)):
        return geometry
    polygons = [p for part in getattr(geometry, "geoms", []) if (p := _polygonal(part)) is not None]
    flat = [g for p in polygons for g in (p.geoms if isinstance(p, MultiPolygon) else [p])]
    return MultiPolygon(flat) if flat else None


def _e7(degrees: float) -> int:
    return round(degrees * 10_000_000)
