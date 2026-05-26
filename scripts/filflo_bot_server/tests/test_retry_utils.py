"""
Unit tests for retry_utils.py — exponential backoff decorator and explicit call.
"""

import pytest
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from retry_utils import retry_with_backoff, retry_with_backoff_call, RetryExhausted


class TestRetryDecorator:

    def test_succeeds_first_try(self):
        call_count = 0

        @retry_with_backoff(max_retries=3, base_delay=0.01)
        def always_works():
            nonlocal call_count
            call_count += 1
            return "ok"

        result = always_works()
        assert result == "ok"
        assert call_count == 1

    def test_retries_then_succeeds(self):
        call_count = 0

        @retry_with_backoff(max_retries=3, base_delay=0.01)
        def fails_twice():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ValueError("not yet")
            return "finally"

        result = fails_twice()
        assert result == "finally"
        assert call_count == 3

    def test_exhausts_retries(self):
        @retry_with_backoff(max_retries=2, base_delay=0.01)
        def always_fails():
            raise TimeoutError("portal down")

        with pytest.raises(RetryExhausted) as exc_info:
            always_fails()
        assert exc_info.value.attempts == 2
        assert isinstance(exc_info.value.last_error, TimeoutError)

    def test_only_catches_specified_exceptions(self):
        @retry_with_backoff(max_retries=3, base_delay=0.01, exceptions=(ValueError,))
        def raises_type_error():
            raise TypeError("wrong type")

        # TypeError is not in the exceptions tuple, so it should propagate immediately
        with pytest.raises(TypeError):
            raises_type_error()

    def test_delay_increases_exponentially(self):
        """Verify delays grow (approximately) with backoff factor."""
        delays = []
        call_count = 0

        @retry_with_backoff(max_retries=4, base_delay=0.1, backoff_factor=2.0, jitter=False)
        def track_delays():
            nonlocal call_count
            call_count += 1
            if call_count < 4:
                delays.append(time.time())
                raise ValueError("fail")
            delays.append(time.time())
            return "done"

        track_delays()
        # Check that delay between attempts roughly doubles
        if len(delays) >= 3:
            gap1 = delays[1] - delays[0]
            gap2 = delays[2] - delays[1]
            # gap2 should be ~2x gap1 (with some tolerance)
            assert gap2 > gap1 * 1.3, f"Expected exponential backoff: gap1={gap1:.3f}, gap2={gap2:.3f}"

    def test_max_delay_cap(self):
        """Delay should never exceed max_delay."""
        call_count = 0

        @retry_with_backoff(
            max_retries=5, base_delay=10.0, max_delay=0.05,
            backoff_factor=10.0, jitter=False,
        )
        def capped_delay():
            nonlocal call_count
            call_count += 1
            if call_count < 5:
                raise ValueError("fail")
            return "ok"

        start = time.time()
        capped_delay()
        elapsed = time.time() - start
        # 4 retries * 0.05s max = 0.2s max
        assert elapsed < 1.0, f"Took too long ({elapsed:.1f}s), max_delay cap not working"


class TestRetryCallExplicit:

    def test_succeeds(self):
        def ok():
            return 42

        result = retry_with_backoff_call(fn=ok, max_retries=3, base_delay=0.01)
        assert result == 42

    def test_retries_then_succeeds(self):
        state = {"count": 0}

        def flaky():
            state["count"] += 1
            if state["count"] < 3:
                raise ConnectionError("dropped")
            return "recovered"

        result = retry_with_backoff_call(
            fn=flaky, max_retries=3, base_delay=0.01,
            exceptions=(ConnectionError,),
        )
        assert result == "recovered"

    def test_exhausts_raises(self):
        def boom():
            raise RuntimeError("nope")

        with pytest.raises(RetryExhausted):
            retry_with_backoff_call(fn=boom, max_retries=2, base_delay=0.01)

    def test_on_retry_callback(self):
        state = {"count": 0}
        retry_log = []

        def flaky():
            state["count"] += 1
            if state["count"] < 3:
                raise ValueError("oops")
            return "ok"

        def on_retry(attempt, error, delay):
            retry_log.append(attempt)

        retry_with_backoff_call(
            fn=flaky, max_retries=3, base_delay=0.01,
            on_retry=on_retry,
        )
        assert retry_log == [1, 2]

    def test_passes_args_and_kwargs(self):
        def add(a, b, extra=0):
            return a + b + extra

        result = retry_with_backoff_call(
            fn=add, args=(3, 4), kwargs={"extra": 10},
            max_retries=1, base_delay=0.01,
        )
        assert result == 17


class TestRetryExhausted:

    def test_attributes(self):
        original = ValueError("boom")
        exc = RetryExhausted(attempts=3, last_error=original)
        assert exc.attempts == 3
        assert exc.last_error is original
        assert "3 retry attempts" in str(exc)
