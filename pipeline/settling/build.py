"""CLI: fetch -> clean/aggregate -> boundaries -> tiles -> manifest.

    python -m settling.build --dep 69 --out data/build/slice
    python -m settling.build --out data/build/national
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import time
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import duckdb
import requests
import shapely
import truststore

from settling import aggregate as agg
from settling.aggregate import AreaResult
from settling.boundaries import Area, Boundaries, load_boundaries
from settling.clean import CleanResult, clean_sales
from settling.join import JoinReport, check_unmatched, reconcile_codes
from settling.reporting import area_rows, spot_checks, tile_stats
from settling.sources import fetch_admin_express, fetch_dvf
from settling.tiles import TileFeature, TileLayer, build_tiles, to_web_mercator, write_pmtiles

REPO_ROOT = Path(__file__).resolve().parents[2]
TILE_FILE = "communes.pmtiles"
ATTRIBUTION = "© IGN, DGFiP/Etalab (Licence Ouverte v2.0)"
DEPARTMENTS_ZOOMS = (0, 7)
COMMUNES_ZOOMS = (6, 10)
CENTER_ZOOM = 5
USER_AGENT = "settling-map-pipeline"

log = logging.getLogger("settling")


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    started = time.perf_counter()
    timings: dict[str, float] = {}
    # Use the OS trust store: TLS-inspecting corporate proxies install their root CA there, not in certifi.
    truststore.inject_into_ssl()
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    with _timed("fetch", timings):
        dvf_path, dvf_source = _dvf_source(session, args.raw, args.dvf_file)
        edition, boundary_paths = fetch_admin_express(session, args.raw)
    con = _open_duckdb(args.raw)
    with _timed("clean", timings):
        cleaned = clean_sales(con, dvf_path, args.dep)
        log.info("cleaning steps: %s", cleaned.steps)
    with _timed("boundaries_and_join", timings):
        boundaries = load_boundaries(boundary_paths, args.dep)
        join = reconcile_codes(con, boundaries)
        log.info("unmatched sales after crosswalk: %d (%.3f%%)", join.unmatched_sales_after, 100 * join.unmatched_share_after)
        check_unmatched(join)
    with _timed("aggregate", timings):
        window_by_months = agg.windows(con, cleaned.newest_date)
        communes = _area_results(con, boundaries.communes, "code_commune", window_by_months, with_trend=True)
        departments = _area_results(con, boundaries.departments, "code_departement", window_by_months, with_trend=False)
    con.close()
    with _timed("tiles", timings):
        tile_path = args.out / TILE_FILE
        tiles = _write_tiles(tile_path, boundaries, communes, departments, window_by_months, args.workers)
    timings["total"] = round(time.perf_counter() - started, 1)

    sources = {"dvf": dvf_source, "boundaries": {"edition_id": edition.edition_id, "edition_date": edition.edition_date}}
    _write_json(args.out / "manifest.json", _manifest(tile_path, sources, cleaned, join, communes, departments))
    _write_json(
        args.out / "build-report.json",
        _report(args, sources, cleaned, join, window_by_months, communes, departments, tiles, timings),
    )
    log.info("wrote %s (%d bytes, %d tiles) in %.1fs", tile_path, tile_path.stat().st_size, len(tiles), timings["total"])


def _open_duckdb(raw: Path) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    # Spill files (raw sale rows) must stay inside the gitignored cache, not in the working directory.
    spill = raw / "duckdb-tmp"
    spill.mkdir(parents=True, exist_ok=True)
    con.execute(f"SET temp_directory = '{spill.as_posix()}'")
    con.execute("SET enable_progress_bar = false")
    return con


def _write_tiles(
    tile_path: Path,
    boundaries: Boundaries,
    communes: list[AreaResult],
    departments: list[AreaResult],
    window_by_months: dict[int, agg.Window],
    workers: int,
) -> dict[int, bytes]:
    layers = [
        _tile_layer("departments", DEPARTMENTS_ZOOMS, departments, with_dep=False),
        _tile_layer("communes", COMMUNES_ZOOMS, communes, with_dep=True),
    ]
    tiles = build_tiles(layers, workers=workers)
    bounds = _bounds(boundaries)
    center = ((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2, CENTER_ZOOM)
    write_pmtiles(tile_path, tiles, _tile_metadata(window_by_months), bounds, center)
    return tiles


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m settling.build", description=__doc__.splitlines()[0])
    parser.add_argument(
        "--dep", action="extend", nargs="+", help="department code(s) to build, e.g. --dep 69 01; default: all metropole"
    )
    parser.add_argument("--out", type=Path, required=True, help="output directory")
    parser.add_argument("--raw", type=Path, default=REPO_ROOT / "data" / "raw", help="download cache directory")
    parser.add_argument(
        "--dvf-file",
        type=Path,
        help="use this local geo-DVF file (csv, csv.gz or parquet) instead of downloading the API-resolved one",
    )
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    return parser.parse_args(argv)


def _dvf_source(session: requests.Session, raw: Path, override: Path | None) -> tuple[Path, dict]:
    if override is not None:
        return override, {"local_file": override.name, "bytes": override.stat().st_size, "sha256": _sha256(override)}
    resource, path = fetch_dvf(session, raw)
    return path, asdict(resource)


def _area_results(
    con: duckdb.DuckDBPyConnection,
    areas: list[Area],
    key_column: str,
    window_by_months: dict[int, agg.Window],
    with_trend: bool,
) -> list[AreaResult]:
    stats = agg.compute_stats(con, key_column, window_by_months[agg.PRIMARY_WINDOW_MONTHS].start)
    yearly = agg.yearly_medians(con, key_column) if with_trend else {}
    results = []
    for area in areas:
        area_stats = agg.area_stats(area.code, agg.is_no_coverage(area.code, area.dep), stats, yearly, window_by_months)
        results.append(AreaResult(area, area_stats, agg.tile_properties(area_stats, with_trend)))
    return results


def feature_id(code: str) -> int:
    """MVT ids must be unsigned integers; Corsica's 2A/2B become 201/202 (no INSEE code starts so)."""
    return int(code.replace("2A", "201").replace("2B", "202"))


def _tile_layer(name: str, zooms: tuple[int, int], results: list[AreaResult], with_dep: bool) -> TileLayer:
    geometries = to_web_mercator([r.area.geometry for r in results])
    features = []
    for result, geometry in zip(results, geometries):
        identity: dict[str, int | str] = {"code": result.area.code, "name": result.area.name}
        if with_dep:
            identity["dep"] = result.area.dep
        features.append(TileFeature(feature_id(result.area.code), identity | result.properties, geometry))
    return TileLayer(name, zooms[0], zooms[1], features)


def _bounds(boundaries: Boundaries) -> tuple[float, float, float, float]:
    minx, miny, maxx, maxy = shapely.total_bounds([a.geometry for a in boundaries.departments])
    return float(minx), float(miny), float(maxx), float(maxy)


PRICE_FIELDS = {
    **{f"p_{k}": f"Number: median EUR/m2 ({label}), absent if no sales" for k, label in
       (("all", "all homes"), ("mai", "houses"), ("app", "flats"))},
    **{f"n_{k}": f"Number: retained sales in the window ({k})" for k in agg.KINDS},
    **{f"c_{k}": f"Number: confidence ({k}) 0 none, 1 low (1-9), 2 medium (10-29), 3 high (30+), 4 no_coverage"
       for k in agg.KINDS},
    "w": "Number: window in months, 36 or 60 (60 = fallback for areas with fewer than 10 sales in 36 months)",
    "period": "String: window as YYYY-MM/YYYY-MM",
}
IDENTITY_FIELDS = {
    "code": "String: INSEE code (use as promoteId; feature id is the numeric form, 2A/2B -> 201/202)",
    "name": "String: official name",
}


def _tile_metadata(window_by_months: dict[int, agg.Window]) -> dict:
    trend = {f"t{y}": f"Number: median EUR/m2 of all homes sold in {y} (absent below {agg.MIN_N_YEARLY} sales)"
             for y in agg.TREND_YEARS}
    primary = window_by_months[agg.PRIMARY_WINDOW_MONTHS]
    return {
        "name": "settling-map communes",
        "description": f"Median property price per m2 (DVF), window {primary.period}",
        "attribution": ATTRIBUTION,
        "type": "overlay",
        "version": datetime.now(UTC).date().isoformat(),
        "vector_layers": [
            {"id": "departments", "minzoom": DEPARTMENTS_ZOOMS[0], "maxzoom": DEPARTMENTS_ZOOMS[1],
             "fields": IDENTITY_FIELDS | PRICE_FIELDS},
            {"id": "communes", "minzoom": COMMUNES_ZOOMS[0], "maxzoom": COMMUNES_ZOOMS[1],
             "fields": IDENTITY_FIELDS | {"dep": "String: department code"} | PRICE_FIELDS | trend},
        ],
    }


def _manifest(
    tile_path: Path,
    sources: dict,
    cleaned: CleanResult,
    join: JoinReport,
    communes: list[AreaResult],
    departments: list[AreaResult],
) -> dict:
    return {
        "version": datetime.now(UTC).date().isoformat(),
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "sources": sources | {"transactions": {"from": str(cleaned.oldest_date), "to": str(cleaned.newest_date)}},
        "tiles": {"file": tile_path.name, "bytes": tile_path.stat().st_size, "sha256": _sha256(tile_path)},
        "counts": {
            "retained_sales": join.retained_sales,
            "communes": len(communes),
            "communes_with_price": sum("p_all" in r.properties for r in communes),
            "communes_on_60_month_fallback": sum(r.properties.get("w") == 60 for r in communes),
            "departments": len(departments),
        },
        "confidence_histogram": {
            "communes": _confidence_histogram(communes),
            "departments": _confidence_histogram(departments),
        },
    }


def _confidence_histogram(results: list[AreaResult]) -> dict[str, dict[str, int]]:
    return {
        kind: dict(sorted(Counter(str(r.properties[f"c_{kind}"]) for r in results).items()))
        for kind in agg.KINDS
    }


def _report(
    args: argparse.Namespace,
    sources: dict,
    cleaned: CleanResult,
    join: JoinReport,
    window_by_months: dict[int, agg.Window],
    communes: list[AreaResult],
    departments: list[AreaResult],
    tiles: dict[int, bytes],
    timings: dict[str, float],
) -> dict:
    return {
        "scope": args.dep or "metropole",
        "sources": sources,
        "transactions": {"from": str(cleaned.oldest_date), "to": str(cleaned.newest_date)},
        "windows": {m: {"start": str(w.start), "end": str(w.end)} for m, w in window_by_months.items()},
        "cleaning_steps": cleaned.steps,
        "overseas_rows_excluded": cleaned.overseas_rows_excluded,
        "join": {
            "dvf_codes": join.dvf_codes,
            "unmatched_codes_before_crosswalk": join.unmatched_codes_before,
            "unmatched_sales_before_crosswalk": join.unmatched_sales_before,
            "crosswalk": [asdict(m) for m in join.mappings],
            "unmatched_after_crosswalk": join.unmatched_after,
            "unmatched_share_after_crosswalk": round(join.unmatched_share_after, 6),
            "boundary_communes_without_sales": join.boundary_communes_without_sales,
            "boundary_communes_without_sales_excluding_no_coverage": sum(
                r.properties.get("n_all") == 0 for r in communes
            ),
        },
        "per_department": {
            r.area.code: {k: v for k, v in r.properties.items() if k[0] in "pncw"} for r in departments
        },
        "spot_checks": spot_checks(communes, departments),
        "tiles": tile_stats(tiles),
        "timings_s": timings,
        "areas": {"communes": area_rows(communes), "departments": area_rows(departments)},
    }


@contextmanager
def _timed(name: str, timings: dict[str, float]) -> Iterator[None]:
    log.info("step %s", name)
    started = time.perf_counter()
    yield
    timings[name] = round(time.perf_counter() - started, 1)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=1, ensure_ascii=False, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
