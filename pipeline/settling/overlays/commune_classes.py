"""The commune classes (flood, clay, radon, cavities) of a communes.pmtiles archive, read back from its tiles.

The classes are computed by `settling.build` and carried by the `communes` layer; the overlays build reads them from the
archive instead of fetching the Géorisques files again, so the lines always describe the same data as the commune
details. A commune that lacks a property in the tiles has no value for it: it is never read as class 0.
"""

from __future__ import annotations

import gzip
import json
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import mapbox_vector_tile
from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import Compression, TileType

LAYER = "communes"
MAGIC = b"PMTiles"


class CommunesArchiveError(RuntimeError):
    """The communes archive cannot give the classes the overlays need."""


@dataclass(frozen=True)
class CommuneClasses:
    values: dict[str, dict[str, int]]  # property -> commune code -> value; a commune without it is not in the inner dict
    communes: set[str]  # codes of every commune of the layer
    zoom: int  # the zoom the layer was read at
    version: str | None  # of the archive: its metadata, else the manifest.json next to it


def read_commune_classes(path: Path, properties: Iterable[str]) -> CommuneClasses:
    """Values of `properties` per commune code, from the lowest zoom of the `communes` layer.

    The tiler writes every commune at every zoom of the layer (the plausibility gate of the communes build checks the
    first zoom against z8), so the first zoom holds them all with the fewest tile copies. A commune cut by a tile
    border appears in several tiles with the same values; a disagreement is an error.
    """
    wanted = list(properties)
    with path.open("rb") as handle:
        if handle.read(len(MAGIC)) != MAGIC:
            raise CommunesArchiveError(f"{path} is not a PMTiles archive")
        get_bytes = MmapSource(handle)
        reader = Reader(get_bytes)
        header = reader.header()
        if header["tile_type"] != TileType.MVT or header["tile_compression"] != Compression.GZIP:
            kinds = f"{header['tile_type']}/{header['tile_compression']}"
            raise CommunesArchiveError(f"{path.name}: expected gzip MVT tiles, header says {kinds}")
        metadata = reader.metadata()
        zoom = _layer_minzoom(metadata, path)
        values: dict[str, dict[str, int]] = {name: {} for name in wanted}
        communes: set[str] = set()
        for (z, _x, _y), data in all_tiles(get_bytes):
            if z != zoom:
                continue
            decoded = mapbox_vector_tile.decode(gzip.decompress(data), default_options={"y_coord_down": True})
            for feature in decoded.get(LAYER, {}).get("features", []):
                _merge(feature["properties"], wanted, values, communes)
    if not communes:
        raise CommunesArchiveError(f"{path.name}: no commune in layer {LAYER!r} at zoom {zoom}")
    return CommuneClasses(values, communes, zoom, metadata.get("version") or _sibling_version(path))


def _merge(properties: dict, wanted: list[str], values: dict[str, dict[str, int]], communes: set[str]) -> None:
    code = properties.get("code")
    if not isinstance(code, str) or not code:
        raise CommunesArchiveError(f"a commune feature has no usable code: {code!r}")
    communes.add(code)
    for name in wanted:
        if name not in properties:
            continue
        value = _class_value(properties[name], code, name)
        if values[name].setdefault(code, value) != value:
            raise CommunesArchiveError(f"commune {code} has {name}={values[name][code]} in one tile and {value} in another")


def _class_value(raw: object, code: str, name: str) -> int:
    """A class or count; the MVT decoder returns a whole number as a float when the tile stored it as one."""
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not float(raw).is_integer():
        raise CommunesArchiveError(f"commune {code}: {name}={raw!r} is not a whole number")
    return int(raw)


def _layer_minzoom(metadata: dict, path: Path) -> int:
    layers = {layer["id"]: layer for layer in metadata.get("vector_layers", [])}
    if LAYER not in layers:
        raise CommunesArchiveError(f"{path.name} has no {LAYER!r} layer (layers: {sorted(layers)})")
    return int(layers[LAYER]["minzoom"])


def _sibling_version(path: Path) -> str | None:
    manifest = path.with_name("manifest.json")
    if not manifest.is_file():
        return None
    try:
        return json.loads(manifest.read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError):
        return None
