"""
api/ratelimit.py: a politeness fence in front of the expensive endpoints.

WHY THIS EXISTS
A survey is not a cheap request. One call can hold a worker thread for
over a minute while it downloads elevation tiles, asks three federal
ArcGIS services about wetlands, water and flood, and fetches a satellite
image. The server runs on a free tier with a small thread pool, so a
simple loop pointed at /survey/polygon can pin every thread and take the
whole product down for everyone, while simultaneously hammering the free
government services we depend on hard enough to get our IP blocked by
them. Neither failure needs malice: one enthusiastic script is enough.

WHAT THIS IS NOT
A security boundary. IPs are shared and spoofable behind proxies, and
anyone determined can work around it. This is the fence that stops
accidents and casual abuse, which is the realistic threat for a small
public tool. Real protection, if we ever need it, is accounts and quotas.

DESIGN
A sliding window per (bucket, ip): remember the timestamps of recent
calls, drop the ones that aged out, and refuse when the list is full.
In memory on purpose. It resets when the server restarts, which is fine
for a fence, and it costs nothing to run.
"""

import time
from typing import Dict, List, Tuple

from fastapi import HTTPException, Request

# (bucket, ip) -> timestamps of recent calls
_hits: Dict[Tuple[str, str], List[float]] = {}

# Stop the dictionary growing forever on a long-lived server. Once it is
# bigger than this we sweep out the entries whose whole history aged out.
_MAX_TRACKED = 2000


def client_ip(request: Request) -> str:
    """Best guess at who is calling. Behind Render's proxy this is the
    forwarded address (uvicorn runs with --proxy-headers)."""
    return request.client.host if request.client else "unknown"


def _sweep(now: float, window_s: float) -> None:
    if len(_hits) <= _MAX_TRACKED:
        return
    stale = [k for k, v in _hits.items() if not v or now - v[-1] >= window_s]
    for k in stale:
        del _hits[k]


def check(request: Request, bucket: str, limit: int, window_s: float,
          what: str) -> None:
    """
    Count this call and raise 429 when the caller is over the limit.

    `what` is the plain-language name of the thing being limited; it goes
    into the message the user reads, because "429" on its own tells a
    person nothing about what they did or when to try again.
    """
    now = time.time()
    _sweep(now, window_s)
    key = (bucket, client_ip(request))
    times = _hits.setdefault(key, [])
    times[:] = [t for t in times if now - t < window_s]
    if len(times) >= limit:
        oldest = times[0]
        wait_s = max(1, int(window_s - (now - oldest)))
        raise HTTPException(
            status_code=429,
            detail=(f"That is {limit} {what} in {int(window_s / 60)} minutes, "
                    "which is our current limit. It keeps this free for "
                    f"everyone and keeps the public data services happy. "
                    f"Try again in about {wait_s} seconds."),
            headers={"Retry-After": str(wait_s)},
        )
    times.append(now)
