"""Resolve and download the upstream sources: geo-DVF, IGN ADMIN EXPRESS COG-CARTO-PE, INSEE BPE and
the Géorisques seismic zoning.

Downloads are untrusted data: they are only ever read as CSV/Parquet, never executed.
"""

from __future__ import annotations

import hashlib
import html
import logging
import re
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import requests

from settling.seismic import parse_zone, read_zone_csv, write_zone_csv

DATAGOUV_DATASET_API = "https://www.data.gouv.fr/api/1/datasets/demandes-de-valeurs-foncieres-geolocalisees/"
DVF_TITLE_MARKER = "fichier unique"

GEOPF_RESOURCE = "https://data.geopf.fr/telechargement/resource/ADMIN-EXPRESS-COG-CARTO-PE"
# Edition ids look like ADMIN-EXPRESS-COG-CARTO-PE_4-0__GEOPARQUET_WGS84G_FRA_2026-01-01:
# one GeoParquet file per layer, WGS84, whole France (metropole + overseas).
ADMIN_EXPRESS_EDITION_MARKER = "__GEOPARQUET_WGS84G_FRA_"
ADMIN_EXPRESS_LAYERS = ("commune", "arrondissement_municipal", "departement", "commune_associee_ou_deleguee")

# The BPE 2025 page links the detail file under a stable, untimestamped path. INSEE refreshes the file
# monthly under the same URL (the page's "Paru le" date moves), so the manifest records its sha256 and
# that date. A new BPE edition gets a new page id: moving to it is a deliberate code change.
BPE_EDITION = "BPE 2025, geography at 2025-01-01"
BPE_PAGE = "https://www.insee.fr/fr/statistiques/8217525"
BPE_URL = "https://www.insee.fr/fr/statistiques/fichier/8217525/BPE25.parquet"
BPE_RELEASE_PATTERN = re.compile(r"Paru le\D{0,20}?(\d{2})/(\d{2})/(\d{4})")
PARQUET_MAGIC = b"PAR1"

GEORISQUES_SEISMIC_API = "https://www.georisques.gouv.fr/api/v1/zonage_sismique"
# The API rejects more codes per request ("ne doit pas dépasser 20"), verified 2026-11-05.
SEISMIC_CODES_PER_REQUEST = 20

ATOM = "{http://www.w3.org/2005/Atom}"
GPF_DL = "{https://data.geopf.fr/annexes/ressources/xsd/gpf_dl.xsd}"
TIMEOUT_S = 60
CHUNK_BYTES = 1 << 20
# Seen 2026-11-10: the 610 MB DVF file was cut at 380 MB on a CI runner. Waits between attempts, in seconds.
DOWNLOAD_RETRY_DELAYS_S = (5, 15, 45, 120, 300)
_INTERRUPTIONS = (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError)

log = logging.getLogger(__name__)


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


@dataclass(frozen=True)
class SeismicSource:
    api: str
    queried_on: str
    codes_queried: int
    zones_returned: int


def fetch_bpe(session: requests.Session, raw_dir: Path) -> Path:
    dest = raw_dir / "bpe" / BPE_URL.rsplit("/", 1)[-1]
    download(session, BPE_URL, dest, expected_size=None, override_flag="--bpe-file")
    with dest.open("rb") as f:
        if f.read(4) != PARQUET_MAGIC:
            raise SourceError(f"{dest} is not a Parquet file; delete it and retry, or pass --bpe-file")
    return dest


def resolve_bpe_release(session: requests.Session) -> str | None:
    """ISO date of the current BPE file release, scraped from the page; None if the page changed."""
    response = session.get(BPE_PAGE, timeout=TIMEOUT_S)
    response.raise_for_status()
    text = re.sub(r"<[^>]+>", " ", html.unescape(response.text))
    match = BPE_RELEASE_PATTERN.search(text)
    return f"{match[3]}-{match[2]}-{match[1]}" if match else None


def fetch_seismic_zones(session: requests.Session, raw_dir: Path, codes: list[str]) -> tuple[SeismicSource, Path]:
    """Zones for `codes` from the Géorisques API, cached per day and code set as a two-column CSV."""
    day = datetime.now(UTC).date().isoformat()
    tag = hashlib.sha1(",".join(codes).encode()).hexdigest()[:12]
    dest = raw_dir / "seismic" / f"georisques-zonage-sismique-{day}-{tag}.csv"
    if not dest.exists():
        write_zone_csv(dest, _query_seismic_api(session, codes))
    return SeismicSource(GEORISQUES_SEISMIC_API, day, len(codes), len(read_zone_csv(dest))), dest


def _query_seismic_api(session: requests.Session, codes: list[str]) -> dict[str, int]:
    zones: dict[str, int] = {}
    for start in range(0, len(codes), SEISMIC_CODES_PER_REQUEST):
        batch = codes[start:start + SEISMIC_CODES_PER_REQUEST]
        params = {"code_insee": ",".join(batch), "page_size": SEISMIC_CODES_PER_REQUEST}
        response = session.get(GEORISQUES_SEISMIC_API, params=params, timeout=TIMEOUT_S)
        _raise_for_blocked(response, GEORISQUES_SEISMIC_API, "--seismic-file")
        payload = response.json()
        if payload.get("total_pages", 1) > 1:
            raise SourceError(f"{GEORISQUES_SEISMIC_API}: unexpected paging for {batch[0]}..: {payload['total_pages']}")
        # Rows without code_insee occur (seen for 75056) and cannot be attributed; they are ignored.
        zones |= {
            row["code_insee"]: zone
            for row in payload.get("data", [])
            if row.get("code_insee") and (zone := parse_zone(row.get("code_zone"))) is not None
        }
    return zones


def download(
    session: requests.Session,
    url: str,
    dest: Path,
    expected_size: int | None,
    expected_sha1: str | None = None,
    override_flag: str = "--dvf-file",
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    """Download to `dest` once; a cached file is trusted if its size matches.

    A transfer that is cut short or times out is retried with growing waits, continuing from the bytes already
    received when the server honours a Range request. A partial file left by an earlier run is never continued: the
    file it belonged to may have changed.
    """
    if dest.exists() and (expected_size is None or dest.stat().st_size == expected_size):
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(dest.name + ".part")
    partial.unlink(missing_ok=True)
    for delay in (*DOWNLOAD_RETRY_DELAYS_S, None):
        try:
            _fetch_into(session, url, partial, override_flag)
            break
        except _INTERRUPTIONS as error:
            if delay is None:
                raise
            log.warning("download of %s interrupted (%s); retrying in %ds", url, type(error).__name__, delay)
            sleep(delay)
    size = partial.stat().st_size
    if expected_size is not None and size != expected_size:
        raise SourceError(f"{url}: got {size} bytes, expected {expected_size}")
    if expected_sha1 is not None and (actual := _sha1_of(partial)) != expected_sha1:
        raise SourceError(f"{url}: sha1 {actual} does not match published {expected_sha1}")
    partial.replace(dest)


def _fetch_into(session: requests.Session, url: str, partial: Path, override_flag: str) -> None:
    """Append what is missing of `url` to `partial`, or rewrite it whole if the server ignores the Range request."""
    received = partial.stat().st_size if partial.exists() else 0
    headers = {"Range": f"bytes={received}-"} if received else {}
    with session.get(url, stream=True, timeout=TIMEOUT_S, headers=headers) as response:
        if response.status_code == 416:  # nothing left to send at that offset: the partial is not a prefix of the file
            partial.unlink()
            raise requests.ConnectionError(f"{url}: range not satisfiable at byte {received}")
        _raise_for_blocked(response, url, override_flag)
        with partial.open("ab" if response.status_code == 206 else "wb") as out:
            for chunk in response.iter_content(CHUNK_BYTES):
                out.write(chunk)


def _sha1_of(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as f:
        while chunk := f.read(CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def _raise_for_blocked(response: requests.Response, url: str, override_flag: str) -> None:
    # A filtering proxy (seen here: Zscaler blocks *.gz "file types") answers 403 with an HTML page.
    content_type = response.headers.get("Content-Type", "")
    if response.status_code == 403 or content_type.startswith("text/html"):
        raise SourceError(
            f"{url}: HTTP {response.status_code} ({content_type}). A proxy may be blocking this file type; "
            f"download it by other means and pass it with {override_flag}."
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
