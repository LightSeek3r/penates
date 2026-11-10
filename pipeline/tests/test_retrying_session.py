import socketserver
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler

import pytest
import requests

from settling.sources import retrying_session


class FlakyServer(socketserver.TCPServer):
    allow_reuse_address = True

    def __init__(self, behaviours: list[str]) -> None:
        self.behaviours = list(behaviours)
        self.served = 0
        super().__init__(("127.0.0.1", 0), _Handler)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/file"


class _Handler(BaseHTTPRequestHandler):
    server: FlakyServer

    def do_GET(self) -> None:  # noqa: N802 (http.server API)
        behaviour = self.server.behaviours.pop(0) if self.server.behaviours else "ok"
        self.server.served += 1
        if behaviour == "hang_up":
            self.close_connection = True  # the connection is dropped without any answer
            return
        status = 503 if behaviour == "503" else 200
        body = b"payload"
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        return None


@pytest.fixture
def flaky() -> Iterator[type[FlakyServer]]:
    servers: list[FlakyServer] = []

    def start(*behaviours: str) -> FlakyServer:
        server = FlakyServer(list(behaviours))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        return server

    yield start  # type: ignore[misc]
    for server in servers:
        server.shutdown()
        server.server_close()


def test_a_connection_dropped_without_an_answer_is_retried(flaky) -> None:
    server = flaky("hang_up", "hang_up")
    response = retrying_session(backoff_factor=0).get(server.url, timeout=5)
    assert (response.status_code, response.content, server.served) == (200, b"payload", 3)


def test_a_503_is_retried_and_the_last_status_is_returned_when_it_persists(flaky) -> None:
    assert retrying_session(backoff_factor=0).get(flaky("503", "ok").url, timeout=5).status_code == 200
    always_down = flaky(*["503"] * 20)
    assert retrying_session(backoff_factor=0).get(always_down.url, timeout=5).status_code == 503


def test_a_plain_session_fails_on_the_same_dropped_connection(flaky) -> None:
    with pytest.raises(requests.ConnectionError):
        requests.Session().get(flaky("hang_up").url, timeout=5)
