"""Resolve and download the two upstream sources (geo-DVF, IGN ADMIN EXPRESS COG-CARTO-PE).

Downloads are untrusted data: they are only ever read as CSV/Parquet, never executed.
"""

from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

import requests

DATAGOUV_DATASET_API = "https://www.data.gouv.fr/api/1/datasets/demandes-de-valeurs-foncieres-geolocalisees/"
DVF_TITLE_MARKER = "fichier unique"

GEOPF_RESOURCE = "https://data.geopf.fr/telechargement/resource/ADMIN-EXPRESS-COG-CARTO-PE"
# Edition ids look like ADMIN-EXPRESS-COG-CARTO-PE_4-0__GEOPARQUET_WGS84G_FRA_2026-01-01:
# one GeoParquet file per layer, WGS84, whole France (metropole + overseas).
ADMIN_EXPRESS_EDITION_MARKER = "__GEOPARQUET_WGS84G_FRA_"
ADMIN_EXPRESS_LAYERS = ("commune", "arrondissement_municipal", "departement", "commune_associee_ou_deleguee")

ATOM = "{http://www.w3.org/2005/Atom}"
GPF_DL = "{https://data.geopf.fr/annexes/ressources/xsd/gpf_dl.xsd}"
TIMEOUT_S = 60
CHUNK_BYTES = 1 << 20


class SourceError(RuntimeError):
    """An upstream source could not be resolved or downloaded as expected."""


@dataclass(frozen=True)
class DvfResource:
    resource_id: str
    title: str
    url: str
    sha1: str | None
    filesize: int | None
    last_modified: str


@dataclass(frozen=True)
class AdminExpressEdition:
    edition_id: str
    edition_date: str
    files: dict[str, str]
    sizes: dict[str, int]


def resolve_dvf_resource(session: requests.Session) -> DvfResource:
    response = session.get(DATAGOUV_DATASET_API, timeout=TIMEOUT_S)
    response.raise_for_status()
    candidates = [
        r for r in response.json()["resources"]
        if DVF_TITLE_MARKER in r["title"].lower() and r.get("format") == "csv.gz"
    ]
    if len(candidates) != 1:
        titles = [c["title"] for c in candidates]
        raise SourceError(f"expected exactly one geo-DVF '{DVF_TITLE_MARKER}' csv.gz resource, found {titles}")
    r = candidates[0]
    checksum = r.get("checksum") or {}
    return DvfResource(
        resource_id=r["id"],
        title=r["title"],
        url=r["url"],
        sha1=checksum.get("value") if checksum.get("type") == "sha1" else None,
        filesize=r.get("filesize"),
        last_modified=r["last_modified"],
    )


def fetch_dvf(session: requests.Session, raw_dir: Path) -> tuple[DvfResource, Path]:
    resource = resolve_dvf_resource(session)
    tag = (resource.sha1 or resource.last_modified.replace(":", ""))[:16]
    dest = raw_dir / "dvf" / f"dvf-{resource.resource_id}-{tag}.csv.gz"
    download(session, resource.url, dest, expected_size=resource.filesize, expected_sha1=resource.sha1)
    return resource, dest


def resolve_admin_express(session: requests.Session) -> AdminExpressEdition:
    editions = [
        href.rsplit("/", 1)[-1]
        for feed in _atom_pages(session, GEOPF_RESOURCE)
        for href in _entry_links(feed)
        if ADMIN_EXPRESS_EDITION_MARKER in href and "/resource/" in href
    ]
    if not editions:
        raise SourceError("no ADMIN EXPRESS COG-CARTO-PE GeoParquet FRA edition found in the geopf feed")
    edition_id = max(editions, key=lambda e: e.rsplit("_", 1)[-1])
    files: dict[str, str] = {}
    sizes: dict[str, int] = {}
    for feed in _atom_pages(session, f"{GEOPF_RESOURCE}/{edition_id}"):
        for link in feed.iter(f"{ATOM}link"):
            href = link.get("href", "")
            name = href.rsplit("/", 1)[-1].removesuffix(".parquet")
            if "/download/" in href and name in ADMIN_EXPRESS_LAYERS:
                files[name] = href
                sizes[name] = int(link.get(f"{GPF_DL}length", "0"))
    missing = set(ADMIN_EXPRESS_LAYERS) - set(files)
    if missing:
        raise SourceError(f"ADMIN EXPRESS edition {edition_id} lacks layers {sorted(missing)}")
    return AdminExpressEdition(edition_id, edition_id.rsplit("_", 1)[-1], files, sizes)


def fetch_admin_express(session: requests.Session, raw_dir: Path) -> tuple[AdminExpressEdition, dict[str, Path]]:
    edition = resolve_admin_express(session)
    paths: dict[str, Path] = {}
    for layer, url in edition.files.items():
        paths[layer] = raw_dir / "admin-express" / edition.edition_id / f"{layer}.parquet"
        download(session, url, paths[layer], expected_size=edition.sizes[layer] or None)
    return edition, paths


def download(
    session: requests.Session, url: str, dest: Path, expected_size: int | None, expected_sha1: str | None = None
) -> None:
    """Download to `dest` once; a cached file is trusted if its size matches."""
    if dest.exists() and (expected_size is None or dest.stat().st_size == expected_size):
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(dest.name + ".part")
    sha1 = hashlib.sha1()
    with session.get(url, stream=True, timeout=TIMEOUT_S) as response:
        _raise_for_blocked(response, url)
        with partial.open("wb") as out:
            for chunk in response.iter_content(CHUNK_BYTES):
                out.write(chunk)
                sha1.update(chunk)
    size = partial.stat().st_size
    if expected_size is not None and size != expected_size:
        raise SourceError(f"{url}: got {size} bytes, expected {expected_size}")
    if expected_sha1 is not None and sha1.hexdigest() != expected_sha1:
        raise SourceError(f"{url}: sha1 {sha1.hexdigest()} does not match published {expected_sha1}")
    partial.replace(dest)


def _raise_for_blocked(response: requests.Response, url: str) -> None:
    # A filtering proxy (seen here: Zscaler blocks *.gz "file types") answers 403 with an HTML page.
    content_type = response.headers.get("Content-Type", "")
    if response.status_code == 403 or content_type.startswith("text/html"):
        raise SourceError(
            f"{url}: HTTP {response.status_code} ({content_type}). A proxy may be blocking this file type; "
            "download it by other means and pass it with --dvf-file."
        )
    response.raise_for_status()


def _atom_pages(session: requests.Session, url: str) -> list[ET.Element]:
    pages: list[ET.Element] = []
    page, page_count = 1, 1
    while page <= page_count:
        response = session.get(url, params={"page": page}, timeout=TIMEOUT_S)
        response.raise_for_status()
        feed = ET.fromstring(response.content)
        page_count = int(feed.get(f"{GPF_DL}pagecount", "1"))
        pages.append(feed)
        page += 1
    return pages


def _entry_links(feed: ET.Element) -> list[str]:
    return [link.get("href", "") for entry in feed.iter(f"{ATOM}entry") for link in entry.iter(f"{ATOM}link")]
