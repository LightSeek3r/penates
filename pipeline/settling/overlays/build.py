"""CLI: build overlays.pmtiles (places as dots, seismic and commune-risk isolines as lines) and its manifest overlays.json.

    python -m settling.overlays --dep 69 23 --out data/build/slice-p3 --bpe-file data/raw/bpe/BPE25.parquet
        --communes-file data/build/slice-p3/communes.pmtiles
    python -m settling.overlays --out data/build/overlays-national --communes-file communes.pmtiles

Separate from settling.build: a refresh of the places or of the zoning never needs the DVF build, and this never
writes communes.pmtiles or manifest.json.
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import requests
import shapely

from settling.boundaries import Boundaries, load_boundaries
from settling.inputs import open_session, resolve_bpe, resolve_communes_archive, resolve_seismic_zones, sha256_of
from settling.overlays.commune_classes import read_commune_classes
from settling.overlays.isolines import IsoLine
from settling.overlays.places import PlaceKind, PlacesResult, dot_properties, load_kinds, read_places
from settling.overlays.risk_lines import RISKS, SOURCE_PROPERTIES, departments_of, risk_isolines
from settling.overlays.seismic_lines import seismic_isolines
from settling.reporting import tile_stats, timed, write_json
from settling.sources import AdminExpressEdition, fetch_admin_express
from settling.tiles import TileFeature, TileLayer, build_tiles, to_web_mercator, write_pmtiles

REPO_ROOT = Path(__file__).resolve().parents[3]
TILE_FILE = "overlays.pmtiles"
MANIFEST_FILE = "overlays.json"
REPORT_FILE = "overlays-report.json"
ATTRIBUTION = "© INSEE (BPE 2025), Géorisques, IGN (Licence Ouverte, Etalab)"
PLACES_ZOOMS = (5, 12)
LINES_ZOOMS = (3, 10)  # the seismic and risk layers
# Tolerance in tile units (1 unit is 1/8 px) for the zooms where a commune outline is far finer than the screen.
LINES_SIMPLIFY_UNITS = {3: 4.0, 4: 4.0, 5: 3.0, 6: 2.0, 7: 2.0}
CENTER_ZOOM = 5
LAYERS = ("places", "seismic", "risk")
PLACES_FIELDS = {
    "k": "String: kind id, one of pipeline/settling/overlays/kinds.json",
    "n": "String: name, only for the kinds marked named; title case, at most 60 characters",
    "c": "Number: BPE rows of the kind at this exact position, present only when 2 or more",
    "a": "Number: 1 when the position is approximate (BPE QUALITE_XY = M), absent otherwise",
}
SEISMIC_FIELDS = {"z": "Number: 2 to 5, the seismic zone the ground rises to across the line (communes zoning)"}
RISK_FIELDS = {
    "r": f"String: overlay id, one of {', '.join(RISKS)}",
    "z": "Number: the class the ground rises to at least across the line (cavities: the number of recorded cavities)",
}
WITHOUT_VALUE_SAMPLE = 20  # codes listed in the report next to the counts

log = logging.getLogger("settling")


@dataclass(frozen=True)
class LayerBuild:
    layer: TileLayer
    fields: dict[str, str]
    sources: dict
    summary: dict  # goes to overlays.json
    report: dict  # goes to overlays-report.json
    bounds: tuple[float, float, float, float]  # lon/lat of what the layer holds


@dataclass(frozen=True)
class Geography:
    """The Admin Express edition in scope, loaded once for the layers drawn on commune outlines."""

    edition: AdminExpressEdition
    boundaries: Boundaries

    @property
    def sources(self) -> dict:
        return {"boundaries": {"edition_id": self.edition.edition_id, "edition_date": self.edition.edition_date}}

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        return tuple(float(v) for v in shapely.total_bounds([a.geometry for a in self.boundaries.departments]))


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    started = time.perf_counter()
    session = open_session()
    names = _layers_to_build(args)
    built: list[LayerBuild] = []
    timings: dict[str, float] = {}
    geography = None
    if {"seismic", "risk"} & set(names):
        with timed("boundaries", timings):
            edition, paths = fetch_admin_express(session, args.raw)
            geography = Geography(edition, load_boundaries(paths, args.dep))
    for name in names:
        with timed(name, timings):
            if name == "places":
                built.append(_build_places(session, args))
            elif name == "seismic":
                built.append(_build_seismic(session, args, geography))
            else:
                built.append(_build_risk(session, args, geography))
    with timed("tiles", timings):
        tiles = build_tiles([b.layer for b in built], workers=args.workers)
    if not tiles:
        raise SystemExit("no tile to write: nothing was found for this scope")
    version = datetime.now(UTC).date().isoformat()
    bounds = _union_bounds([b.bounds for b in built])
    center = ((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2, CENTER_ZOOM)
    tile_path = args.out / TILE_FILE
    write_pmtiles(tile_path, tiles, _tile_metadata(built, version), bounds, center)
    timings["total"] = round(time.perf_counter() - started, 1)

    sources = {name: source for b in built for name, source in b.sources.items()}
    write_json(args.out / MANIFEST_FILE, {
        "version": version,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "sources": sources,
        "tiles": {"file": TILE_FILE, "bytes": tile_path.stat().st_size, "sha256": sha256_of(tile_path)},
        "layers": {b.layer.name: b.summary for b in built},
    })
    write_json(args.out / REPORT_FILE, {
        "scope": args.dep or "metropole",
        "layers": {b.layer.name: b.report for b in built},
        "tiles": tile_stats(tiles),
        "timings_s": timings,
    })
    log.info("wrote %s (%d bytes, %d tiles) in %.1fs", tile_path, tile_path.stat().st_size, len(tiles), timings["total"])


def _build_places(session: requests.Session, args: argparse.Namespace) -> LayerBuild:
    path, source = resolve_bpe(session, args.raw, args.bpe_file)
    kinds = load_kinds()
    result = read_places(path, kinds, args.dep)
    if not result.dots:
        raise SystemExit(f"no place found in {path.name} for departments {args.dep}")
    lonlat = np.array([(dot.lon, dot.lat) for dot in result.dots])
    points = to_web_mercator(list(shapely.points(lonlat)))
    minzoom = {kind.id: kind.minzoom for kind in kinds}
    features = [
        TileFeature(i, dot_properties(dot), point, minzoom[dot.kind])
        for i, (dot, point) in enumerate(zip(result.dots, points), start=1)
    ]
    dots_by_kind = Counter(dot.kind for dot in result.dots)
    summary = {"kinds": {kind.id: dots_by_kind[kind.id] for kind in kinds}, "rows_skipped": result.rows_skipped}
    bounds = (*lonlat.min(axis=0), *lonlat.max(axis=0))
    layer = TileLayer("places", *PLACES_ZOOMS, features)
    return LayerBuild(layer, PLACES_FIELDS, {"bpe": source}, summary, _places_report(result, kinds), bounds)


def _build_seismic(session: requests.Session, args: argparse.Namespace, geography: Geography) -> LayerBuild:
    boundaries = geography.boundaries
    source, zones, zone_report = resolve_seismic_zones(
        session, args.raw, args.seismic_file, boundaries.communes, boundaries.merged_codes
    )
    result = seismic_isolines(boundaries.communes, zones)
    features = _line_features([({"z": part.level}, part) for part in result.parts])
    summary = {"lines": _by_level(result.lines), "length_km": _km_by_level(result.length_m)}
    report = summary | {
        "parts": len(result.parts),
        "communes_by_zone": zone_report.by_zone,
        "zone_methods": zone_report.by_method,
    }
    return LayerBuild(
        TileLayer("seismic", *LINES_ZOOMS, features, LINES_SIMPLIFY_UNITS),
        SEISMIC_FIELDS,
        {"seismic": source} | geography.sources,
        summary,
        report,
        geography.bounds,
    )


def _build_risk(session: requests.Session, args: argparse.Namespace, geography: Geography) -> LayerBuild:
    path, origin = resolve_communes_archive(session, args.raw, args.communes_file, args.communes_url)
    classes = read_commune_classes(path, SOURCE_PROPERTIES)
    result = risk_isolines(geography.boundaries.communes, classes)
    log.info("risk: %d communes in %s at z%d (version %s)", len(classes.communes), path.name, classes.zoom, classes.version)
    for id_, codes in result.without_value.items():
        if codes:
            log.warning("risk %s: %d communes have no value, no line is drawn along them", id_, len(codes))
    if result.without_boundary:
        log.warning(
            "risk: %d communes of the archive have no boundary in this scope, e.g. %s",
            len(result.without_boundary), result.without_boundary[:5],
        )
    parts = [({"r": id_, "z": part.level}, part) for id_, lines in result.by_risk.items() for part in lines.parts]
    features = _line_features(parts)
    summary = {
        "lines": {id_: _by_level(lines.lines) for id_, lines in result.by_risk.items()},
        "length_km": {id_: _km_by_level(lines.length_m) for id_, lines in result.by_risk.items()},
        "source": {"communes_version": classes.version, "sha256": origin["sha256"], "bytes": origin["bytes"]},
    }
    report = {
        "lines": summary["lines"],
        "length_km": summary["length_km"],
        "parts": len(features),
        "communes_without_value": {
            id_: {"count": len(codes), "by_department": departments_of(codes), "sample": codes[:WITHOUT_VALUE_SAMPLE]}
            for id_, codes in result.without_value.items()
        },
        "archive": {
            "zoom": classes.zoom,
            "communes": len(classes.communes),
            "communes_without_boundary": {
                "count": len(result.without_boundary),
                "sample": result.without_boundary[:WITHOUT_VALUE_SAMPLE],
            },
        },
    }
    sources = {"communes": origin | {"version": classes.version, "zoom": classes.zoom}} | geography.sources
    return LayerBuild(
        TileLayer("risk", *LINES_ZOOMS, features, LINES_SIMPLIFY_UNITS), RISK_FIELDS, sources, summary, report, geography.bounds
    )


def _layers_to_build(args: argparse.Namespace) -> list[str]:
    names = list(args.only or LAYERS)
    if "risk" in names and not (args.communes_file or args.communes_url):
        if args.only:
            raise SystemExit("--only risk needs --communes-file or --communes-url")
        log.warning("risk layer skipped: pass --communes-file or --communes-url (a communes.pmtiles with fl, cl, rn, cv)")
        names.remove("risk")
    return names


def _line_features(parts: list[tuple[dict, IsoLine]]) -> list[TileFeature]:
    geometries = to_web_mercator([part.geometry for _, part in parts])
    return [
        TileFeature(i, properties, geometry) for i, ((properties, _), geometry) in enumerate(zip(parts, geometries), start=1)
    ]


def _by_level(counts: dict[int, int]) -> dict[str, int]:
    return {str(level): count for level, count in counts.items()}


def _km_by_level(metres: dict[int, float]) -> dict[str, float]:
    return {str(level): round(length / 1000, 1) for level, length in metres.items()}


def _places_report(result: PlacesResult, kinds: list[PlaceKind]) -> dict:
    dots = {kind.id: [d for d in result.dots if d.kind == kind.id] for kind in kinds}
    return {
        "rows_skipped": result.rows_skipped,
        "kinds": {
            kind.id: {
                "rows": result.rows_by_kind.get(kind.id, 0),
                "dots": len(dots[kind.id]),
                "dots_sharing_position": sum(d.rows >= 2 for d in dots[kind.id]),
                "approximate_dots": sum(d.approximate for d in dots[kind.id]),
                "named_dots": sum(d.name is not None for d in dots[kind.id]),
                "names_unusable_rows": result.names_unusable.get(kind.id, 0),
                "names_shortened": sum(d.name is not None and d.name.endswith("…") for d in dots[kind.id]),
            }
            for kind in kinds
        },
    }


def _tile_metadata(built: list[LayerBuild], version: str) -> dict:
    return {
        "name": "settling-map overlays",
        "description": "Places (INSEE BPE 2025) as dots; seismic zone and commune risk (flood, clay, radon, cavities) isolines as lines",
        "attribution": ATTRIBUTION,
        "type": "overlay",
        "version": version,
        "vector_layers": [
            {"id": b.layer.name, "minzoom": b.layer.minzoom, "maxzoom": b.layer.maxzoom, "fields": b.fields} for b in built
        ],
    }


def _union_bounds(boxes: list[tuple[float, float, float, float]]) -> tuple[float, float, float, float]:
    minx, miny, maxx, maxy = zip(*boxes)
    return min(minx), min(miny), max(maxx), max(maxy)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m settling.overlays", description=__doc__.splitlines()[0])
    parser.add_argument(
        "--dep", action="extend", nargs="+", help="department code(s), e.g. --dep 69 01; default: all metropole"
    )
    parser.add_argument("--out", type=Path, required=True, help="output directory")
    parser.add_argument("--raw", type=Path, default=REPO_ROOT / "data" / "raw", help="download cache directory")
    parser.add_argument("--bpe-file", type=Path, help="use this local INSEE BPE 2025 Parquet file instead of downloading")
    parser.add_argument(
        "--seismic-file", type=Path, help="use this CSV (columns code_insee,code_zone) instead of querying Géorisques"
    )
    communes = parser.add_mutually_exclusive_group()
    communes.add_argument(
        "--communes-file", type=Path, help="communes.pmtiles carrying the fl, cl, rn and cv classes, for the risk layer"
    )
    communes.add_argument("--communes-url", help="download that communes.pmtiles to the raw cache instead of a local file")
    parser.add_argument("--only", choices=LAYERS, action="append", help="build only this layer (repeatable)")
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    return parser.parse_args(argv)


if __name__ == "__main__":
    main()
