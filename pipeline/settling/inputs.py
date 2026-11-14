"""Inputs shared by the builds: the HTTP session, the INSEE BPE file, the seismic zones, the communes archive and file hashes."""

from __future__ import annotations

import hashlib
import logging
from dataclasses import asdict
from pathlib import Path

import requests
import truststore

from settling import seismic
from settling.boundaries import Area
from settling.seismic import SeismicReport
from settling.sources import (
    BPE_EDITION, BPE_URL, fetch_bpe, fetch_communes_archive, fetch_seismic_zones, resolve_bpe_release, retrying_session,
)

USER_AGENT = "settling-map-pipeline"

log = logging.getLogger("settling")


def open_session() -> requests.Session:
    # Use the OS trust store: TLS-inspecting corporate proxies install their root CA there, not in certifi.
    truststore.inject_into_ssl()
    session = retrying_session()
    session.headers["User-Agent"] = USER_AGENT
    return session


def resolve_bpe(session: requests.Session, raw: Path, override: Path | None) -> tuple[Path, dict]:
    path = override if override is not None else fetch_bpe(session, raw)
    try:
        release = resolve_bpe_release(session)
    except requests.RequestException as error:
        log.warning("BPE release date unavailable: %s", error)
        release = None
    if release is None:
        log.warning("BPE release date not found on the INSEE page; the manifest records only the file hash")
    source = {"edition": BPE_EDITION, "url": BPE_URL, "page_release_date": release,
              "bytes": path.stat().st_size, "sha256": sha256_of(path)}
    return path, source | ({"local_file": path.name} if override is not None else {})


def resolve_seismic_zones(
    session: requests.Session, raw: Path, override: Path | None, communes: list[Area], merged_codes: dict[str, str]
) -> tuple[dict, dict[str, int], SeismicReport]:
    commune_codes = [a.code for a in communes]
    if override is not None:
        path = override
        source = {"local_file": path.name}
    else:
        resource, path = fetch_seismic_zones(session, raw, seismic.codes_to_query(commune_codes, merged_codes))
        source = asdict(resource)
    zones, report = seismic.assign_zones(commune_codes, seismic.read_zone_csv(path), merged_codes)
    zones, report = seismic.fill_from_neighbours(zones, report, communes)
    return source | {"sha256": sha256_of(path)}, zones, report


def resolve_communes_archive(
    session: requests.Session, raw: Path, override: Path | None, url: str | None
) -> tuple[Path, dict]:
    """The communes.pmtiles the risk lines read their classes from, with where it came from, its size and its hash."""
    if override is not None:
        if not override.is_file():
            raise SystemExit(f"--communes-file {override}: no such file")
        path, origin = override, {"local_file": override.name}
    else:
        path, origin = fetch_communes_archive(session, raw, url), {"url": url}
    return path, origin | {"bytes": path.stat().st_size, "sha256": sha256_of(path)}


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()
