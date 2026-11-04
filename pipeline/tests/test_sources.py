import gzip
from pathlib import Path

import duckdb
import pytest
from conftest import FIXTURE_CSV

from settling.clean import clean_sales
from settling.sources import SourceError, resolve_dvf_resource


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return self.payload


class FakeSession:
    def __init__(self, resources: list[dict]) -> None:
        self.resources = resources

    def get(self, url: str, timeout: int) -> FakeResponse:
        return FakeResponse({"resources": self.resources})


def _resource(title: str, fmt: str = "csv.gz") -> dict:
    return {
        "id": title, "title": title, "format": fmt, "url": f"https://static.example/{title}",
        "checksum": {"type": "sha1", "value": "abc"}, "filesize": 10, "last_modified": "2026-10-21T08:58:04",
    }


def test_picks_the_single_five_year_file() -> None:
    session = FakeSession([
        _resource("DVF 2025"),
        _resource("DVF juillet 2021 - juin 2026 - fichier unique"),
        _resource("Documentation", fmt="url"),
    ])
    resource = resolve_dvf_resource(session)
    assert resource.title == "DVF juillet 2021 - juin 2026 - fichier unique"
    assert resource.sha1 == "abc"


def test_ambiguous_five_year_file_is_an_error() -> None:
    session = FakeSession([_resource("A fichier unique"), _resource("B fichier unique")])
    with pytest.raises(SourceError):
        resolve_dvf_resource(session)


def test_gzipped_csv_reads_like_plain_csv(tmp_path: Path, con: duckdb.DuckDBPyConnection) -> None:
    gz = tmp_path / "dvf.csv.gz"
    gz.write_bytes(gzip.compress(FIXTURE_CSV.read_bytes()))
    plain = clean_sales(duckdb.connect(), FIXTURE_CSV, departments=None)
    assert clean_sales(con, gz, departments=None).steps == plain.steps
