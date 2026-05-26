"""
╔══════════════════════════════════════════════════════════════════╗
║  Filflo Bot — Retry & Exponential Backoff Utilities              ║
║                                                                  ║
║  Provides decorators and helpers for resilient retries with     ║
║  exponential backoff + jitter for flaky portal interactions.    ║
╚══════════════════════════════════════════════════════════════════╝

Usage:
    from retry_utils import retry_with_backoff, RetryExhausted

    # As a decorator
    @retry_with_backoff(max_retries=3, base_delay=2.0, exceptions=(TimeoutError,))
    def flaky_portal_call():
        ...

    # As a context manager / explicit call
    result = retry_with_backoff_call(
        fn=some_function,
        args=(arg1, arg2),
        max_retries=3,
        logger=logger,
    )
"""

import time
import random
import logging
import functools
from typing import Callable, Tuple, Type


class RetryExhausted(Exception):
    """Raised when all retry attempts have been exhausted."""

    def __init__(self, attempts: int, last_error: Exception):
        self.attempts = attempts
        self.last_error = last_error
        super().__init__(
            f"All {attempts} retry attempts exhausted. Last error: {last_error}"
        )


def retry_with_backoff(
    max_retries: int = 3,
    base_delay: float = 2.0,
    max_delay: float = 60.0,
    backoff_factor: float = 2.0,
    jitter: bool = True,
    exceptions: Tuple[Type[Exception], ...] = (Exception,),
    logger: logging.Logger = None,
):
    """
    Decorator that retries a function with exponential backoff.

    Args:
        max_retries:    Maximum number of retry attempts.
        base_delay:     Initial delay in seconds before first retry.
        max_delay:      Maximum delay cap in seconds.
        backoff_factor: Multiplier for each subsequent delay.
        jitter:         Add random jitter to prevent thundering herd.
        exceptions:     Tuple of exception types to catch and retry.
        logger:         Optional logger for retry messages.

    Example:
        @retry_with_backoff(max_retries=3, exceptions=(TimeoutError, ConnectionError))
        def call_portal():
            ...
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            _logger = logger or logging.getLogger(func.__module__)
            last_error = None

            for attempt in range(1, max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_error = e
                    if attempt == max_retries:
                        _logger.error(
                            f"[Retry] {func.__name__}: All {max_retries} attempts failed. "
                            f"Last error: {e}"
                        )
                        raise RetryExhausted(max_retries, e) from e

                    delay = min(base_delay * (backoff_factor ** (attempt - 1)), max_delay)
                    if jitter:
                        delay = delay * (0.5 + random.random())

                    _logger.warning(
                        f"[Retry] {func.__name__}: Attempt {attempt}/{max_retries} failed "
                        f"({type(e).__name__}: {e}). Retrying in {delay:.1f}s..."
                    )
                    time.sleep(delay)

            raise RetryExhausted(max_retries, last_error)

        return wrapper
    return decorator


def retry_with_backoff_call(
    fn: Callable,
    args: tuple = (),
    kwargs: dict = None,
    max_retries: int = 3,
    base_delay: float = 2.0,
    max_delay: float = 60.0,
    backoff_factor: float = 2.0,
    jitter: bool = True,
    exceptions: Tuple[Type[Exception], ...] = (Exception,),
    logger: logging.Logger = None,
    on_retry: Callable = None,
):
    """
    Explicit retry call (non-decorator form).

    Args:
        fn:           The function to call.
        args:         Positional arguments.
        kwargs:       Keyword arguments.
        max_retries:  Max attempts.
        base_delay:   Initial delay seconds.
        max_delay:    Maximum delay cap.
        backoff_factor: Delay multiplier.
        jitter:       Add random jitter.
        exceptions:   Exception types to catch.
        logger:       Logger instance.
        on_retry:     Optional callback(attempt, error, delay) called before each retry.

    Returns:
        The return value of fn() on success.

    Raises:
        RetryExhausted if all attempts fail.
    """
    _logger = logger or logging.getLogger(__name__)
    kwargs = kwargs or {}
    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            return fn(*args, **kwargs)
        except exceptions as e:
            last_error = e
            if attempt == max_retries:
                _logger.error(
                    f"[Retry] {fn.__name__}: All {max_retries} attempts failed. "
                    f"Last error: {e}"
                )
                raise RetryExhausted(max_retries, e) from e

            delay = min(base_delay * (backoff_factor ** (attempt - 1)), max_delay)
            if jitter:
                delay = delay * (0.5 + random.random())

            _logger.warning(
                f"[Retry] {fn.__name__}: Attempt {attempt}/{max_retries} failed "
                f"({type(e).__name__}: {e}). Retrying in {delay:.1f}s..."
            )

            if on_retry:
                on_retry(attempt, e, delay)

            time.sleep(delay)

    raise RetryExhausted(max_retries, last_error)
