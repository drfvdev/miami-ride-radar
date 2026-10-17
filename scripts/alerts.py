#!/usr/bin/env python3
"""Email driver alerts from events.json.

Usage:
  python3 scripts/alerts.py advance      # new High-priority events + cancellations/reschedules
  python3 scripts/alerts.py day-before   # tomorrow's events: official end times + pickup windows
  python3 scripts/alerts.py test         # sends tomorrow's digest marked TEST, records nothing
  python3 scripts/alerts.py seed         # mark every current event as already announced
Options: --today YYYY-MM-DD, --dry-run (print instead of sending)

Sending uses Gmail SMTP with env GMAIL_ADDRESS, GMAIL_APP_PASSWORD and optional ALERT_TO.
What was sent is recorded in alerts/state.json so no alert is sent twice.
"""
import argparse
import json
import os
import smtplib
import sys
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
EVENTS = ROOT / "events.json"
STATE = ROOT / "alerts" / "state.json"
TZ = ZoneInfo("America/New_York")
SITE = "https://drfvdev.github.io/miami-ride-radar/"


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {"advance_sent": [], "day_before_sent": [], "pending_notices": []}


def save_state(state):
    STATE.parent.mkdir(exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2) + "\n")


def clock(hhmm):
    if not hhmm:
        return ""
    h, m = map(int, hhmm.split(":"))
    return f"{(h % 12) or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


def nice_date(d):
    return date.fromisoformat(d).strftime("%a %b %-d")


def describe(e):
    end = clock(e["end"]) + " (official)" if e.get("end_verified") and e.get("end") else "Not published"
    if e.get("end_verified") and e.get("end_date") and e["end_date"] != e["date"]:
        end = nice_date(e["end_date"]) + " " + end
    lines = [
        f"{e['title']}  [{e['priority']}]",
        f"  {nice_date(e['date'])}" + (f" – {nice_date(e['date_end'])}" if e.get("date_end") and e["date_end"] != e["date"] else "")
        + (f", starts {clock(e['start'])}" if e.get("start") else ""),
        f"  {e['venue']}, {e['area']} — {e['address']}",
        f"  Official end: {end}",
        f"  Pickup window: {e['window']} ({e['window_type']})",
    ]
    if e.get("note"):
        lines.append(f"  Note: {e['note']}")
    lines.append(f"  Source: {e['source']}")
    return "\n".join(lines)


def describe_notice(n):
    if n["type"] == "cancelled":
        return f"CANCELLED: {n['title']} ({nice_date(n['date'])}) {n.get('reason', '')}\n  Source: {n['source']}"
    return f"RESCHEDULED: {n['title']} moved {nice_date(n['from'])} → {nice_date(n['to'])}\n  Source: {n['source']}"


FOOTER = ("\n\nPickup windows are estimates, not verified departure times or earnings predictions. "
          "Confirm event status before driving.\n" + SITE)


def advance_email(events, state, today):
    sent = set(state["advance_sent"])
    new = [e for e in events if e["priority"] == "High" and e["id"] not in sent
           and (e.get("date_end") or e["date"]) >= today.isoformat()]
    notices = state["pending_notices"]
    if not new and not notices:
        return None, new
    parts = []
    if new:
        parts.append("NEW MAJOR EVENTS\n\n" + "\n\n".join(describe(e) for e in new))
    if notices:
        parts.append("CHANGES\n\n" + "\n\n".join(describe_notice(n) for n in notices))
    bits = []
    if new:
        bits.append(f"{len(new)} new major event" + ("s" if len(new) > 1 else ""))
    if notices:
        bits.append(f"{len(notices)} change" + ("s" if len(notices) > 1 else ""))
    return ("Miami Ride Radar: " + ", ".join(bits), "\n\n".join(parts) + FOOTER), new


def tomorrow_events(events, today):
    t = (today + timedelta(days=1)).isoformat()
    return t, [e for e in events if e["date"] == t]


def day_before_email(events, today):
    t, items = tomorrow_events(events, today)
    if not items:
        return t, None
    items.sort(key=lambda e: (e["priority"] != "High", e.get("start") or "99:99"))
    body = (f"Tomorrow, {nice_date(t)}: {len(items)} tracked event" + ("s" if len(items) > 1 else "")
            + "\n\n" + "\n\n".join(describe(e) for e in items) + FOOTER)
    return t, (f"Miami Ride Radar: tomorrow {nice_date(t)} ({len(items)} event" + ("s" if len(items) > 1 else "") + ")", body)


def send(subject, body, dry_run):
    if dry_run:
        print(f"--- DRY RUN ---\nSubject: {subject}\n\n{body}")
        return
    user = os.environ["GMAIL_ADDRESS"]
    msg = EmailMessage()
    msg["From"] = f"Miami Ride Radar <{user}>"
    msg["To"] = os.environ.get("ALERT_TO") or user
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s:
        s.login(user, os.environ["GMAIL_APP_PASSWORD"])
        s.send_message(msg)
    print(f"sent: {subject}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["advance", "day-before", "test", "seed"])
    ap.add_argument("--today")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    today = date.fromisoformat(a.today) if a.today else datetime.now(TZ).date()
    events = json.loads(EVENTS.read_text())["events"]
    state = load_state()

    if a.mode == "seed":
        state["advance_sent"] = sorted(set(state["advance_sent"]) | {e["id"] for e in events})
        save_state(state)
        print(f"seeded {len(state['advance_sent'])} ids")
    elif a.mode == "advance":
        email, new = advance_email(events, state, today)
        if not email:
            print("no new major events or changes")
            return 0
        send(*email, a.dry_run)
        if not a.dry_run:
            state["advance_sent"] = sorted(set(state["advance_sent"]) | {e["id"] for e in new})
            state["pending_notices"] = []
            save_state(state)
    elif a.mode == "day-before":
        t, email = day_before_email(events, today)
        if t in state["day_before_sent"]:
            print(f"day-before alert for {t} already sent")
            return 0
        if not email:
            print(f"no events on {t}")
            return 0
        send(*email, a.dry_run)
        if not a.dry_run:
            state["day_before_sent"] = sorted(set(state["day_before_sent"]) | {t})[-60:]
            save_state(state)
    else:  # test
        t, email = day_before_email(events, today)
        subject, body = email or (f"Miami Ride Radar: no events tomorrow {nice_date(t)}", "No tracked events tomorrow." + FOOTER)
        send("[TEST] " + subject, "This is a test alert. Nothing was recorded.\n\n" + body, a.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
