"""A small communes.pmtiles for tests, written by the project's own tiler."""

from pathlib import Path

from settling.boundaries import Area
from settling.tiles import TileFeature, TileLayer, build_tiles, to_web_mercator, write_pmtiles


def write_communes_archive(
    path: Path, communes: dict[str, tuple[Area, dict]], zooms: tuple[int, int] = (4, 5), metadata: dict | None = None
) -> Path:
    """The communes (code -> area and tile properties) as a `communes` layer over `zooms`, like the real archive."""
    geometries = to_web_mercator([area.geometry for area, _ in communes.values()])
    features = [
        TileFeature(i, {"code": code} | properties, geometry)
        for i, ((code, (_, properties)), geometry) in enumerate(zip(communes.items(), geometries), start=1)
    ]
    tiles = build_tiles([TileLayer("communes", *zooms, features)], workers=1)
    declared = {"vector_layers": [{"id": "communes", "minzoom": zooms[0], "maxzoom": zooms[1], "fields": {}}]}
    descriptor = {"name": "test", "version": "2026-11-06"} | declared | (metadata or {})
    write_pmtiles(path, tiles, descriptor, (2, 46, 4, 47), (3, 46.5, 5))
    return path
