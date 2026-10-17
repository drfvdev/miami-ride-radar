#!/usr/bin/env python3
"""Merge researched event proposals into events.json safely.

Usage:
  python3 scripts/update_events.py proposals.json [--today YYYY-MM-DD] [--dry-run]

proposals.json:
  {
    "events": [ { ...event fields..., "confirmed": true } ],
    "cancellations": [ { "id": "...", "source": "https://...", "reason": "..." } ]
  }

Rules
- Only proposals with "confirmed": true (found on an official / primary source) are used.
- An existing listing is never removed just because research did not find it again.
- A verified official end time is never replaced by an unverified one.
- "end" is only kept when "end_verified" is true; pickup windows stay labeled as
  estimates ("estimate" or "unverified" must appear in window_type).
- Events are deduplicated by id (and by same title + date + venue).
- Date changes on an existing id are recorded as reschedules; cancellations remove the
  listing. Both are queued in alerts/state.json so the next alert email reports them.
- Past events are dropped and updated_at is always set.
"""
import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
EVENTS = ROOT / "events.json"
STATE = ROOT / "alerts" / "state.json"
TZ = ZoneInfo("America/New_York")

REQUIRED = ["id", "title", "date", "category", "area", "venue", "address",
            "priority", "window", "window_type", "source"]
FIELDS = ["id", "title", "date", "date_end", "start", "end", "end_date", "end_verified",
          "category", "area", "venue", "address", "priority", "window", "window_start",
          "window_end", "window_type", "note", "source"]
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def last_day(e):
    return max(e.get("date_end") or e["date"], e.get("end_date") or e["date"], e["date"])


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def clean(p):
    """Return (event, error). Normalizes a proposal into the feed schema."""
    if p.get("confirmed") is not True:
        return None, "not confirmed on an official source"
    missing = [k for k in REQUIRED if not str(p.get(k, "")).strip()]
    if missing:
        return None, "missing " + ", ".join(missing)
    e = {k: p[k] for k in FIELDS if k in p}
    e["id"] = str(e["id"]).strip().lower()
    if not ID_RE.match(e["id"]):
        return None, "bad id"
    for k in ("date", "date_end", "end_date"):
        if e.get(k) and not DATE_RE.match(e[k]):
            return None, "bad " + k
    try:
        date.fromisoformat(e["date"])
    except ValueError:
        return None, "bad date"
    e["start"] = e.get("start") or ""
    for k in ("start", "window_start", "window_end"):
        if e.get(k) and not TIME_RE.match(e[k]):
            return None, "bad " + k
    if not e["source"].startswith("https://"):
        return None, "source must be an https URL"
    if e["priority"] not in ("High", "Medium"):
        return None, "priority must be High or Medium"
    if not re.search(r"estimate|unverified", e["window_type"], re.I):
        return None, "window_type must say it is an estimate or unverified"
    e["end_verified"] = e.get("end_verified") is True and bool(TIME_RE.match(e.get("end") or ""))
    if not e["end_verified"]:
        e["end"] = ""
        e.pop("end_date", None)
    e.setdefault("note", "")
    return e, None


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {"advance_sent": [], "day_before_sent": [], "pending_notices": []}


def merge(feed, proposals, today, now):
    today_s = today.isoformat()
    log = []
    notices = []
    current = {}
    for e in feed["events"]:
        if last_day(e) < today_s:
            log.append(f"dropped past: {e['id']}")
            continue
        current.setdefault(e["id"], e)  # dedupe existing ids, first wins

    for c in proposals.get("cancellations", []):
        cid = str(c.get("id", "")).strip().lower()
        if cid in current and str(c.get("source", "")).startswith("https://"):
            old = current.pop(cid)
            log.append(f"cancelled: {cid}")
            notices.append({"type": "cancelled", "id": cid, "title": old["title"],
                            "date": old["date"], "source": c["source"],
                            "reason": c.get("reason", "")})
        else:
            log.append(f"ignored cancellation (unknown id or no https source): {cid}")

    seen = set()
    for p in proposals.get("events", []):
        e, err = clean(p)
        if err:
            log.append(f"skipped {p.get('id', '?')}: {err}")
            continue
        if e["id"] in seen:
            log.append(f"skipped duplicate proposal: {e['id']}")
            continue
        seen.add(e["id"])
        if last_day(e) < today_s:
            log.append(f"skipped past proposal: {e['id']}")
            continue
        old = current.get(e["id"])
        if old is None:
            key = (norm(e["title"]), e["date"], norm(e["venue"]))
            twin = next((x for x in current.values()
                         if (norm(x["title"]), x["date"], norm(x["venue"])) == key), None)
            if twin:
                log.append(f"skipped duplicate of {twin['id']}: {e['id']}")
                continue
            current[e["id"]] = e
            log.append(f"added: {e['id']}")
            continue
        rescheduled = e["date"] != old["date"]
        if not rescheduled and old.get("end_verified") and not e["end_verified"]:
            # keep the verified official end time
            e["end"], e["end_verified"] = old["end"], True
            if old.get("end_date"):
                e["end_date"] = old["end_date"]
        if rescheduled:
            notices.append({"type": "rescheduled", "id": e["id"], "title": e["title"],
                            "from": old["date"], "to": e["date"], "source": e["source"]})
            log.append(f"rescheduled: {e['id']} {old['date']} -> {e['date']}")
        if e != old:
            current[e["id"]] = e
            if not rescheduled:
                log.append(f"updated: {e['id']}")

    events = sorted(current.values(), key=lambda x: (x["date"], x.get("start") or "99:99", x["id"]))
    out = {"updated_at": now.isoformat(timespec="seconds"),
           "timezone": feed.get("timezone", "America/New_York"),
           "events": events}
    return out, notices, log


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("proposals")
    ap.add_argument("--today")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    now = datetime.now(TZ)
    today = date.fromisoformat(a.today) if a.today else now.date()
    feed = json.loads(EVENTS.read_text())
    proposals = json.loads(Path(a.proposals).read_text())
    out, notices, log = merge(feed, proposals, today, now)
    print("\n".join(log) or "no changes")
    print(f"{len(out['events'])} events in feed; {len(notices)} new notices")
    if a.dry_run:
        return 0
    EVENTS.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    if notices:
        state = load_state()
        state["pending_notices"].extend(notices)
        STATE.parent.mkdir(exist_ok=True)
        STATE.write_text(json.dumps(state, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
