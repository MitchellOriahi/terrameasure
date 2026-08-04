"""
api/reports.py: shareable survey reports
=========================================

The idea: after you run a survey, you can turn it into a public,
read-only report that anyone can open with a short link, no login.

  POST /reports          : send the survey snapshot, get back a slug
  GET  /reports/{slug}   : anyone fetches the snapshot by slug

The frontend will later render /r/{slug} as a pretty report page.
This file only handles storing and serving the raw snapshot JSON.

Storage follows the same "seam" philosophy as DEMFetcher: one small
interface (ReportStore) with two implementations behind it.

  * SupabaseReportStore : real database, used on Render where the
                          SUPABASE_SERVICE_ROLE env var is set.
  * MemoryReportStore   : a plain Python dict, used automatically in
                          local dev. Reports vanish on restart, and
                          we log a line saying so.

The rest of the code never cares which one it is talking to.

WHAT WE KEEP AND WHAT WE STRIP (the image storage rule)
-------------------------------------------------------
A survey response carries several base64 images. Storing all of them
for every shared report would get expensive, so the rule is:

  1. Strip EVERY field whose name ends in "_b64" from the snapshot
     (satellite photo, decorated slope/contour maps, everything).
  2. Then put back ONLY the two clean map overlays
     (slope_map_clean_b64 and contour_map_clean_b64), and only if
     the two of them TOGETHER are under 500 KB.

Why those two? They are the images the report page drapes over the
map, and they compress well because they are simple color fields.
The satellite photo is the big one (often over 1 MB), and the report
page can re-fetch imagery from Esri at view time instead, so storing
it would be paying for something we can get free later.

If the two overlays blow the 500 KB budget we drop them too. The
report still works: all the numbers, the score, the DEM grid, and
the elevation profile survive. The page just shows the map without
the painted overlay.
"""

import json
import logging
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Optional

import requests as http_requests
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from engine import scoring

log = logging.getLogger("terrameasure.reports")

router = APIRouter()

# ---------------------------------------------------------------------------
# Tunable limits, gathered in one place so they are easy to reason about
# ---------------------------------------------------------------------------

# Reject any incoming report bigger than this (measured as JSON text).
# A normal survey snapshot with images stripped is well under this.
MAX_REQUEST_BYTES = 2_000_000          # ~2 MB

# Combined budget for the two clean overlay PNGs we are willing to store.
OVERLAY_BUDGET_BYTES = 500_000         # ~500 KB

# Simple politeness limit: how many reports one IP may create per hour.
RATE_LIMIT_MAX = 20
RATE_LIMIT_WINDOW_S = 3600             # one hour, in seconds

# The two image fields we try to keep (see the rule in the docstring).
KEEP_IMAGE_FIELDS = ("slope_map_clean_b64", "contour_map_clean_b64")


# ---------------------------------------------------------------------------
# The storage seam: one tiny interface, two implementations
# ---------------------------------------------------------------------------
class ReportStore:
    """
    What any report store must be able to do. The endpoints only ever
    call these two methods, so swapping the backend never touches them.
    """

    def save(self, slug: str, title: Optional[str], snapshot: dict) -> str:
        """Store a report. Returns the created_at timestamp as an ISO string."""
        raise NotImplementedError

    def get(self, slug: str) -> Optional[dict]:
        """
        Fetch a report by slug. Returns
        {"slug", "title", "snapshot", "created_at"} or None if unknown.
        """
        raise NotImplementedError


class MemoryReportStore(ReportStore):
    """
    Local-dev fallback: reports live in a plain dict inside this process.
    Perfect for testing, useless for production (a restart wipes it).
    """

    def __init__(self):
        self._reports: dict[str, dict] = {}

    def save(self, slug: str, title: Optional[str], snapshot: dict) -> str:
        created_at = datetime.now(timezone.utc).isoformat()
        self._reports[slug] = {
            "slug": slug,
            "title": title,
            "snapshot": snapshot,
            "created_at": created_at,
        }
        return created_at

    def get(self, slug: str) -> Optional[dict]:
        return self._reports.get(slug)


class SupabaseReportStore(ReportStore):
    """
    Production store: a `reports` table in Supabase (which is Postgres
    with a REST API in front of it, called PostgREST).

    We talk plain HTTP with the `requests` library, no SDK needed.
    The service_role key comes from the environment only. It is the
    all-powerful key, which is exactly why the table has row level
    security on with NO public policies: only this server can touch it.
    The SQL to create the table lives in docs/reports_table.sql.
    """

    def __init__(self, url: str, service_role_key: str):
        # PostgREST lives under /rest/v1/ on every Supabase project.
        self._endpoint = url.rstrip("/") + "/rest/v1/reports"
        # Supabase wants the key twice: once as the API key, once as
        # the bearer token that decides what role we act as.
        self._headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

    def save(self, slug: str, title: Optional[str], snapshot: dict) -> str:
        # "Prefer: return=representation" asks PostgREST to echo the
        # inserted row back, so we get the DB-generated created_at.
        resp = http_requests.post(
            self._endpoint,
            headers={**self._headers, "Prefer": "return=representation"},
            json={"slug": slug, "title": title, "snapshot": snapshot},
            timeout=15,
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"Supabase insert failed ({resp.status_code}): {resp.text[:200]}")
        row = resp.json()[0]
        return row["created_at"]

    def get(self, slug: str) -> Optional[dict]:
        # PostgREST filter syntax: ?slug=eq.<value> means WHERE slug = value.
        resp = http_requests.get(
            self._endpoint,
            headers=self._headers,
            params={"slug": f"eq.{slug}",
                    "select": "slug,title,snapshot,created_at"},
            timeout=15,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Supabase read failed ({resp.status_code}): {resp.text[:200]}")
        rows = resp.json()
        return rows[0] if rows else None


def _make_store() -> ReportStore:
    """
    Pick the backend once, at startup:
      service_role key present in the environment -> real Supabase store
      absent (local dev)                          -> in-memory store
    """
    service_role = os.environ.get("SUPABASE_SERVICE_ROLE", "")
    if service_role:
        # SUPABASE_URL is public information (it is in web/auth.html too),
        # so a coded default is fine. The SECRET is only ever read from env.
        url = os.environ.get("SUPABASE_URL",
                             "https://onmrarnvanpufmlsshvj.supabase.co")
        log.info("Reports: using Supabase store at %s", url)
        return SupabaseReportStore(url, service_role)
    log.warning("Reports: SUPABASE_SERVICE_ROLE not set, using in-memory "
                "store. Shared reports will NOT survive a restart.")
    return MemoryReportStore()


# The one store instance the endpoints use. Tests swap this out.
_store: ReportStore = _make_store()


# ---------------------------------------------------------------------------
# Minimal per-IP rate limiting for report creation
# ---------------------------------------------------------------------------
# ip -> list of timestamps of that IP's recent POSTs. In-memory on purpose:
# this is a politeness fence against accidental loops and casual abuse,
# not a security boundary. Good enough for one small server.
_rate_hits: dict[str, list[float]] = {}


def _check_rate_limit(ip: str) -> None:
    """Raise 429 if this IP already created RATE_LIMIT_MAX reports this hour."""
    now = time.time()

    # Housekeeping: drop IPs whose entire history has aged out of the
    # window. Without this the dict grows one entry per unique IP forever
    # (a slow memory leak on a long-lived server).
    if len(_rate_hits) > 500:
        stale = [k for k, v in _rate_hits.items()
                 if not v or now - v[-1] >= RATE_LIMIT_WINDOW_S]
        for k in stale:
            del _rate_hits[k]

    hits = _rate_hits.setdefault(ip, [])
    # Forget anything older than the window, so old activity does not count.
    hits[:] = [t for t in hits if now - t < RATE_LIMIT_WINDOW_S]
    if len(hits) >= RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail=(f"You have created {RATE_LIMIT_MAX} share links in the "
                    "last hour, which is our current limit. This keeps the "
                    "free service free for everyone. Please try again in a "
                    "little while."))
    hits.append(now)


# ---------------------------------------------------------------------------
# Snapshot slimming: apply the image storage rule
# ---------------------------------------------------------------------------
def _slim_snapshot(snapshot: dict) -> dict:
    """
    Return a copy of the snapshot with the image rule applied:
    strip every *_b64 field, then restore the two clean overlays
    if together they fit inside OVERLAY_BUDGET_BYTES.
    """
    survey = snapshot.get("survey")
    if not isinstance(survey, dict):
        return snapshot

    # Copy so we never mutate what the caller handed us.
    slim_survey = {k: v for k, v in survey.items()
                   if not k.endswith("_b64")}

    # Would the two clean overlays fit in the budget together?
    overlays = {k: survey[k] for k in KEEP_IMAGE_FIELDS
                if isinstance(survey.get(k), str) and survey[k]}
    total = sum(len(v) for v in overlays.values())
    if overlays and total <= OVERLAY_BUDGET_BYTES:
        slim_survey.update(overlays)
    elif overlays:
        log.info("Reports: overlays total %d bytes, over the %d budget, "
                 "storing report without them.", total, OVERLAY_BUDGET_BYTES)

    slim = dict(snapshot)
    slim["survey"] = slim_survey
    return slim


# ---------------------------------------------------------------------------
# Request/response shapes
# ---------------------------------------------------------------------------
class CreateReportRequest(BaseModel):
    # The full survey response JSON the frontend received. We treat it as
    # an opaque dict on purpose: if the survey shape grows a field, reports
    # keep working without this file changing.
    survey: dict
    # Optional extras the report page will want to show.
    parcel: Optional[dict] = None
    vertices: Optional[list] = None       # the drawn polygon, [{lat, lon}, ...]
    title: Optional[str] = None


@router.post("/reports")
def create_report(req: CreateReportRequest, request: Request):
    """
    Turn a survey into a shareable report. Returns the slug and the
    public path (/r/{slug}) the frontend will render.
    """
    # Politeness fence first, before we do any real work.
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)

    # Size check: measure the request as JSON text. json.dumps gives us a
    # consistent yardstick whatever the client's whitespace habits were.
    raw = json.dumps(req.model_dump(), separators=(",", ":"))
    if len(raw) > MAX_REQUEST_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(f"Report too large ({len(raw):,} bytes, limit "
                    f"{MAX_REQUEST_BYTES:,}). Tip: the big base64 image "
                    "fields are stripped server-side anyway, so you can "
                    "omit them before posting."))

    # Apply the image storage rule (see the module docstring).
    snapshot = _slim_snapshot({
        "survey": req.survey,
        "parcel": req.parcel,
        "vertices": req.vertices,
    })

    # 8 URL-safe characters. token_urlsafe(6) encodes 6 random bytes as
    # exactly 8 characters of [A-Za-z0-9_-], about 2.8e14 possibilities,
    # so guessing a slug is hopeless and collisions are vanishingly rare.
    slug = secrets.token_urlsafe(6)

    try:
        created_at = _store.save(slug, req.title, snapshot)
    except Exception as e:
        log.error("Reports: save failed: %s", e)
        raise HTTPException(status_code=502,
                            detail="Could not store the report right now. "
                                   "Please try again in a moment.")

    return {"slug": slug,
            "url_path": f"/r/{slug}",
            "created_at": created_at}


@router.get("/reports/{slug}")
def get_report(slug: str):
    """
    Public, no-login read of a stored report. Anyone with the link can
    view it; that is the whole point of a share link.
    """
    try:
        row = _store.get(slug)
    except Exception as e:
        log.error("Reports: read failed: %s", e)
        raise HTTPException(status_code=502,
                            detail="Could not load the report right now. "
                                   "Please try again in a moment.")

    if row is None:
        raise HTTPException(status_code=404,
                            detail="No report found for this link. It may "
                                   "have been mistyped or never existed.")

    return {"slug": row["slug"],
            "title": row.get("title"),
            "snapshot": row["snapshot"],
            "created_at": row["created_at"],
            # Every public artifact carries the honesty banner.
            "disclaimer": scoring.DISCLAIMER}
