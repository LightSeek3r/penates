import hashlib
from pathlib import Path

import pytest
import requests

from settling.sources import DOWNLOAD_RETRY_DELAYS_S, SourceError, download, fetch_communes_archive

PAYLOAD = bytes(range(256)) * 40  # 10,240 bytes
URL = "https://static.example/file.bin"


class Answer:
    """One scripted HTTP answer; `cut_after` bytes are streamed, then the connection breaks."""

    def __init__(self, status: int = 200, body: bytes = PAYLOAD, cut_after: int | None = None) -> None:
        self.status_code = status
        self.headers = {"Content-Type": "application/octet-stream"}
        self.body = body
        self.cut_after = cut_after

    def __enter__(self) -> "Answer":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))

    def iter_content(self, chunk_size: int):
        if self.cut_after is None:
            yield self.body
            return
        yield self.body[: self.cut_after]
        raise requests.exceptions.ChunkedEncodingError("IncompleteRead")


class ScriptedSession:
    def __init__(self, *answers: Answer | Exception) -> None:
        self.answers = list(answers)
        self.requested_ranges: list[str | None] = []

    def get(self, url: str, stream: bool, timeout: int, headers: dict) -> Answer:
        self.requested_ranges.append(headers.get("Range"))
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def _no_sleep(seconds: float) -> None:
    return None


def test_a_transfer_cut_midway_resumes_from_the_bytes_received(tmp_path: Path) -> None:
    cut = 4000
    session = ScriptedSession(Answer(cut_after=cut), Answer(206, PAYLOAD[cut:]))
    dest = tmp_path / "file.bin"
    download(session, URL, dest, len(PAYLOAD), hashlib.sha1(PAYLOAD).hexdigest(), sleep=_no_sleep)
    assert dest.read_bytes() == PAYLOAD
    assert session.requested_ranges == [None, f"bytes={cut}-"]
    assert not dest.with_name("file.bin.part").exists()


def test_a_server_that_ignores_range_is_read_again_from_the_start(tmp_path: Path) -> None:
    session = ScriptedSession(Answer(cut_after=4000), Answer(200, PAYLOAD))
    dest = tmp_path / "file.bin"
    download(session, URL, dest, len(PAYLOAD), hashlib.sha1(PAYLOAD).hexdigest(), sleep=_no_sleep)
    assert dest.read_bytes() == PAYLOAD


def test_timeouts_and_resets_are_retried_with_growing_waits(tmp_path: Path) -> None:
    waits: list[float] = []
    session = ScriptedSession(requests.ReadTimeout("slow"), requests.ConnectionError("reset"), Answer())
    dest = tmp_path / "file.bin"
    download(session, URL, dest, len(PAYLOAD), sleep=waits.append)
    assert waits == list(DOWNLOAD_RETRY_DELAYS_S[:2])
    assert dest.read_bytes() == PAYLOAD


def test_it_gives_up_after_the_last_wait_and_leaves_no_final_file(tmp_path: Path) -> None:
    session = ScriptedSession(*[requests.ConnectionError("down")] * (len(DOWNLOAD_RETRY_DELAYS_S) + 1))
    dest = tmp_path / "file.bin"
    with pytest.raises(requests.ConnectionError):
        download(session, URL, dest, len(PAYLOAD), sleep=_no_sleep)
    assert not dest.exists()


def test_a_range_the_server_cannot_satisfy_restarts_the_file(tmp_path: Path) -> None:
    session = ScriptedSession(Answer(cut_after=4000), Answer(416, b""), Answer(200, PAYLOAD))
    dest = tmp_path / "file.bin"
    download(session, URL, dest, len(PAYLOAD), hashlib.sha1(PAYLOAD).hexdigest(), sleep=_no_sleep)
    assert dest.read_bytes() == PAYLOAD
    assert session.requested_ranges == [None, "bytes=4000-", None]


def test_a_wrong_checksum_after_resuming_is_still_refused(tmp_path: Path) -> None:
    corrupt = PAYLOAD[:4000] + b"\x00" * (len(PAYLOAD) - 4000)
    session = ScriptedSession(Answer(cut_after=4000), Answer(206, corrupt[4000:]))
    dest = tmp_path / "file.bin"
    with pytest.raises(SourceError, match="does not match published"):
        download(session, URL, dest, len(PAYLOAD), hashlib.sha1(PAYLOAD).hexdigest(), sleep=_no_sleep)
    assert not dest.exists()


def test_a_partial_file_from_an_earlier_run_is_not_continued(tmp_path: Path) -> None:
    dest = tmp_path / "file.bin"
    dest.with_name("file.bin.part").write_bytes(b"stale bytes of another version")
    session = ScriptedSession(Answer())
    download(session, URL, dest, len(PAYLOAD), hashlib.sha1(PAYLOAD).hexdigest(), sleep=_no_sleep)
    assert session.requested_ranges == [None]
    assert dest.read_bytes() == PAYLOAD


def test_a_communes_archive_is_cached_under_a_name_made_from_its_url(tmp_path: Path) -> None:
    session = ScriptedSession(Answer(), Answer())
    first = fetch_communes_archive(session, tmp_path, URL)
    assert first.parent == tmp_path / "communes" and first.read_bytes() == PAYLOAD
    assert fetch_communes_archive(session, tmp_path, URL) == first
    assert len(session.requested_ranges) == 1, "the second call reads the cache"
    assert fetch_communes_archive(session, tmp_path, URL + "?v=2") != first, "another URL is another file"
