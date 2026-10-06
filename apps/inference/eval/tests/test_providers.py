"""The HTTP client without a network: retries, Retry-After, transport errors and what the latencies mean.

`urlopen` is replaced by a scripted opener and `time` by a fake clock, so nothing sleeps and nothing connects.
Every check has a control that fails when the behaviour under test is taken away.
"""

from __future__ import annotations

import email.message
import http.client
import io
import json
import unittest
import urllib.error
from unittest import mock

from harness import providers


class FakeResponse:
    def __init__(self, body: str = '{"ok": true}', status: int = 200):
        self.status = status
        self._body = body

    def read(self) -> bytes:
        return self._body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def http_error(code: int, retry_after: str | None = None, body: str = "busy") -> urllib.error.HTTPError:
    headers = email.message.Message()
    if retry_after is not None:
        headers["Retry-After"] = retry_after
    return urllib.error.HTTPError("https://x.invalid/v1/chat/completions", code, "status", headers, io.BytesIO(body.encode()))


class Clock:
    """A fake monotonic clock: `sleep` and every scripted call move it, nothing waits."""

    def __init__(self, call_seconds: float = 0.5):
        self.now = 0.0
        self.sleeps: list[float] = []
        self.call_seconds = call_seconds

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class ScriptedClient(unittest.TestCase):
    """Builds a ChatClient whose opener plays a script: each item is a response or an exception to raise."""

    def client(self, script: list, **config) -> tuple[providers.ChatClient, Clock]:
        clock = Clock()
        cfg = {"base_url": "https://x.invalid/v1", "retry_backoff_base_seconds": 1.0, **config}
        client = providers.ChatClient("p", cfg)
        for step in script:
            if isinstance(step, urllib.error.HTTPError):
                self.addCleanup(step.close)
        steps = iter(script)

        def open_(_request, timeout=None):
            clock.now += clock.call_seconds
            step = next(steps)
            if isinstance(step, BaseException):
                raise step
            return step

        client._opener = mock.Mock(open=open_)
        patcher = mock.patch.multiple(providers.time, monotonic=clock.monotonic, sleep=clock.sleep)
        patcher.start()
        self.addCleanup(patcher.stop)
        return client, clock


class RateLimit(ScriptedClient):
    def test_a_429_then_a_200_is_one_success_after_two_attempts(self):
        client, clock = self.client([http_error(429), FakeResponse()], max_retries=2)
        raw = client.post_raw({"model": "m"})
        self.assertEqual((raw.status, raw.attempts, raw.transport_error), (200, 2, None))
        self.assertEqual(clock.sleeps, [1.0])
        # control: with no retries left the same 429 is the answer, after one attempt
        client, _ = self.client([http_error(429), FakeResponse()], max_retries=0)
        raw = client.post_raw({"model": "m"})
        self.assertEqual((raw.status, raw.attempts), (429, 1))

    def test_a_429_twice_records_the_status_and_both_attempts(self):
        client, _ = self.client([http_error(429, body="slow down"), http_error(429, body="slow down")], max_retries=1)
        raw = client.post_raw({"model": "m"})
        self.assertEqual((raw.status, raw.attempts, raw.transport_error), (429, 2, None))
        self.assertEqual(raw.body_text, "slow down")

    def test_retry_after_is_honoured_when_it_is_longer_than_the_backoff(self):
        client, clock = self.client([http_error(429, retry_after="7"), FakeResponse()], max_retries=1)
        client.post_raw({"model": "m"})
        self.assertEqual(clock.sleeps, [7.0])
        # control: no header, the plain backoff
        client, clock = self.client([http_error(429), FakeResponse()], max_retries=1)
        client.post_raw({"model": "m"})
        self.assertEqual(clock.sleeps, [1.0])

    def test_a_short_retry_after_never_shortens_the_backoff(self):
        client, clock = self.client([http_error(429, retry_after="0"), FakeResponse()], max_retries=1)
        client.post_raw({"model": "m"})
        self.assertEqual(clock.sleeps, [1.0])

    def test_retry_after_is_capped_and_a_bad_value_is_ignored(self):
        client, clock = self.client([http_error(429, retry_after="99999"), FakeResponse()], max_retries=1)
        client.post_raw({"model": "m"})
        self.assertEqual(clock.sleeps, [providers.MAX_RETRY_AFTER_SECONDS])
        client, clock = self.client([http_error(429, retry_after="soon"), FakeResponse()], max_retries=1)
        client.post_raw({"model": "m"})
        self.assertEqual(clock.sleeps, [1.0])

    def test_retry_after_is_read_only_on_a_429(self):
        client, clock = self.client([http_error(503, retry_after="30"), FakeResponse()], max_retries=1)
        client.post_raw({"model": "m"})
        self.assertEqual(clock.sleeps, [1.0])

    def test_a_400_is_returned_at_once_without_a_retry(self):
        client, clock = self.client([http_error(400, body="bad schema"), FakeResponse()], max_retries=3)
        raw = client.post_raw({"model": "m"})
        self.assertEqual((raw.status, raw.attempts, clock.sleeps), (400, 1, []))

    def test_the_old_post_waits_for_retry_after_too(self):
        client, clock = self.client([http_error(429, retry_after="5"), FakeResponse()], max_retries=1)
        self.assertEqual(client.post({"model": "m"}), {"ok": True})
        self.assertEqual(clock.sleeps, [5.0])


class TransportErrors(ScriptedClient):
    FAMILY = (
        ConnectionResetError("reset by peer"),
        http.client.RemoteDisconnected("Remote end closed connection without response"),
        http.client.IncompleteRead(b"par", 100),
        BrokenPipeError("broken pipe"),
        TimeoutError("timed out"),
        urllib.error.URLError("dns"),
    )

    def test_each_transport_error_is_retried_and_then_succeeds(self):
        for error in self.FAMILY:
            with self.subTest(error=type(error).__name__):
                client, clock = self.client([error, FakeResponse()], max_retries=1)
                raw = client.post_raw({"model": "m"})
                self.assertEqual((raw.status, raw.attempts, raw.transport_error), (200, 2, None))
                self.assertEqual(clock.sleeps, [1.0])

    def test_a_transport_error_that_never_clears_becomes_a_recorded_response(self):
        for error in self.FAMILY:
            with self.subTest(error=type(error).__name__):
                client, _ = self.client([error, error], max_retries=1)
                raw = client.post_raw({"model": "m"})
                self.assertIsNone(raw.status)
                self.assertEqual(raw.attempts, 2)
                self.assertTrue(raw.transport_error.startswith(type(error).__name__), raw.transport_error)

    def test_a_dropped_connection_while_reading_the_body_is_a_transport_error(self):
        class Cut(FakeResponse):
            def read(self):
                raise http.client.IncompleteRead(b"{", 50)

        client, _ = self.client([Cut(), FakeResponse()], max_retries=1)
        raw = client.post_raw({"model": "m"})
        self.assertEqual((raw.status, raw.attempts), (200, 2))

    def test_a_dropped_connection_while_reading_an_error_body_keeps_the_status(self):
        error = http_error(503)
        self.addCleanup(error.close)
        error.read = mock.Mock(side_effect=http.client.IncompleteRead(b"", 10))
        client, _ = self.client([error], max_retries=0)
        raw = client.post_raw({"model": "m"})
        self.assertEqual((raw.status, raw.body_text, raw.attempts), (503, "", 1))

    def test_a_programming_error_is_not_swallowed(self):
        # control: the catch is the transport family, not a blanket
        client, _ = self.client([ValueError("not a transport problem")], max_retries=1)
        with self.assertRaises(ValueError):
            client.post_raw({"model": "m"})

    def test_the_old_post_retries_the_same_family(self):
        client, _ = self.client([ConnectionResetError("reset"), http.client.RemoteDisconnected("gone"), FakeResponse()], max_retries=2)
        self.assertEqual(client.post({"model": "m"}), {"ok": True})
        client, _ = self.client([ConnectionResetError("reset"), ConnectionResetError("reset")], max_retries=1)
        with self.assertRaises(ConnectionResetError):
            client.post({"model": "m"})


class Latency(ScriptedClient):
    def test_total_latency_covers_every_attempt_and_the_backoff(self):
        client, _ = self.client([http_error(429, retry_after="4"), ConnectionResetError("reset"), FakeResponse()], max_retries=2)
        raw = client.post_raw({"model": "m"})
        self.assertEqual(raw.attempts, 3)
        self.assertEqual(raw.attempt_latencies_ms, [500.0, 500.0, 500.0])
        self.assertEqual(raw.latency_ms, 500.0)  # the last attempt only
        # 3 calls of 0.5 s, a 4 s Retry-After sleep and a 2 s backoff sleep
        self.assertAlmostEqual(raw.total_latency_ms, 7500.0)
        self.assertGreater(raw.total_latency_ms, raw.latency_ms)

    def test_a_single_attempt_has_equal_total_and_last_latency(self):
        client, _ = self.client([FakeResponse()], max_retries=2)
        raw = client.post_raw({"model": "m"})
        self.assertEqual((raw.total_latency_ms, raw.latency_ms, raw.attempt_latencies_ms), (500.0, 500.0, [500.0]))


class Defaults(unittest.TestCase):
    def test_max_retries_defaults_to_four_and_a_config_value_wins(self):
        self.assertEqual(providers.ChatClient("p", {"base_url": "https://x.invalid/v1"}).max_retries, 4)
        self.assertEqual(providers.ChatClient("p", {"base_url": "https://x.invalid/v1", "max_retries": 1}).max_retries, 1)

    def test_the_committed_configs_still_set_their_own_retries(self):
        from .support import EVAL_ROOT

        config = json.loads((EVAL_ROOT / "configs/eu-cell-35-eu-newprompt.json").read_text(encoding="utf-8"))
        self.assertEqual(config["providers"]["openrouter_eu"]["max_retries"], 1)


if __name__ == "__main__":
    unittest.main()
