#!/usr/bin/env python3
"""Email driver alerts from events.json.

Usage:
  python3 scripts/alerts.py advance      # new High-priority events + cancellations/reschedules
  python3 scripts/alerts.py day-before   # tomorrow's events: official end times + pickup windows
  python3 scripts/alerts.py test         # sends tomorrow's digest marked TEST, records nothing
  python3 scripts/alerts.py seed         # mark every current event as already announced
Options: --today YYYY-MM-DD, --dry-run (print instead of sending), --html FILE (save the HTML)

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
from html import escape
from pathlib import Path
from urllib.parse import quote
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
    return f"{(h % 12) or 12}{':%02d' % m if m else ''} {'AM' if h < 12 else 'PM'}"


def nice_date(d):
    return date.fromisoformat(d).strftime("%a %b %-d")


def end_text(e):
    if not (e.get("end_verified") and e.get("end")):
        return "Ends: not published"
    day = f" {nice_date(e['end_date'])[:3]}" if e.get("end_date") and e["end_date"] != e["date"] else ""
    return f"Ends {clock(e['end'])}{day} (official)"


def when_text(e):
    parts = [f"Starts {clock(e['start'])}" if e.get("start") else "Start time TBA", end_text(e)]
    return " · ".join(parts)


def estimate_label(e):
    return "unverified" if "unverified" in e.get("window_type", "").lower() else "estimate"


def short_title(e):
    return e["title"].split(" · ")[0]


def links(e):
    return (f"https://waze.com/ul?q={quote(e['address'])}&navigate=yes",
            f"{SITE}#event={quote(e['id'])}")


# ---------- plain text (fallback and phone notification preview) ----------

def text_card(e, show_date=False):
    head = f"{nice_date(e['date'])} · " if show_date else ""
    return (f"{head}PICKUP {e['window']} ({estimate_label(e)})\n"
            f"{e['title']} — {e['venue']}\n"
            f"{when_text(e)}\n"
            f"Waze: {links(e)[0]}")


def text_notice(n):
    if n["type"] == "cancelled":
        return f"CANCELLED: {n['title']} ({nice_date(n['date'])})"
    return f"MOVED: {n['title']} {nice_date(n['from'])} → {nice_date(n['to'])}"


TEXT_FOOTER = "\n\nPickup windows are estimates. Confirm before driving.\n" + SITE


# ---------- HTML ----------

def html_card(e, show_date=False):
    waze, details = links(e)
    high = e["priority"] == "High"
    tag = ('<span style="background:#fde68a;color:#78350f;font-size:11px;font-weight:700;'
           'padding:2px 6px;border-radius:4px;margin-left:6px;vertical-align:middle">HIGH</span>') if high else ""
    date_line = (f'<div style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;'
                 f'letter-spacing:.04em;margin-bottom:2px">{escape(nice_date(e["date"]))}</div>') if show_date else ""
    note = (f'<div style="font-size:13px;color:#6b7280;margin-top:6px">{escape(e["note"])}</div>'
            if e.get("note") and len(e["note"]) <= 140 else "")
    btn = ('display:inline-block;padding:8px 14px;border-radius:6px;font-size:14px;font-weight:600;'
           'text-decoration:none;margin-right:8px')
    return f"""
<div style="border:1px solid #e5e7eb;border-left:4px solid {'#f59e0b' if high else '#9ca3af'};border-radius:8px;padding:12px 14px;margin:0 0 12px">
  {date_line}
  <div style="font-size:22px;font-weight:800;color:#111827;line-height:1.2">{escape(e['window'])}{tag}</div>
  <div style="font-size:12px;color:#6b7280;margin-bottom:8px">pickup window · {estimate_label(e)}</div>
  <div style="font-size:16px;font-weight:700;color:#111827">{escape(e['title'])}</div>
  <div style="font-size:14px;color:#374151">{escape(e['venue'])} · {escape(e['area'])}</div>
  <div style="font-size:14px;color:#374151">{escape(when_text(e))}</div>
  {note}
  <div style="margin-top:10px">
    <a href="{escape(waze)}" style="{btn};background:#2563eb;color:#ffffff">Waze</a>
    <a href="{escape(details)}" style="{btn};background:#f3f4f6;color:#111827">Details</a>
  </div>
</div>"""


def html_notice(n):
    if n["type"] == "cancelled":
        label, color, text = "CANCELLED", "#b91c1c", f"{n['title']} · {nice_date(n['date'])}"
    else:
        label, color, text = "MOVED", "#1d4ed8", f"{n['title']} · {nice_date(n['from'])} → {nice_date(n['to'])}"
    return (f'<div style="padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;margin:0 0 8px;font-size:15px">'
            f'<b style="color:{color}">{label}</b> {escape(text)}</div>')


def html_page(heading, sub, body):
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:520px;margin:0 auto;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="font-size:20px;font-weight:800;color:#111827">{escape(heading)}</div>
  <div style="font-size:14px;color:#6b7280;margin:2px 0 14px">{escape(sub)}</div>
  {body}
  <div style="font-size:12px;color:#9ca3af;margin-top:16px">Pickup windows are estimates, not guaranteed. Confirm before driving.
  <a href="{SITE}" style="color:#6b7280">Open Miami Ride Radar</a></div>
</div></body></html>"""


def plural(n, word):
    return f"{n} {word}" + ("" if n == 1 else "s")


# ---------- emails: each returns (subject, text, html) ----------

def advance_email(events, state, today):
    sent = set(state["advance_sent"])
    new = [e for e in events if e["priority"] == "High" and e["id"] not in sent
           and (e.get("date_end") or e["date"]) >= today.isoformat()]
    notices = state["pending_notices"]
    if not new and not notices:
        return None, new
    new.sort(key=lambda e: (e["date"], e.get("start") or "99:99"))
    bits = []
    if new:
        bits.append("New: " + ", ".join(f"{short_title(e)} {nice_date(e['date'])[4:]}" for e in new[:3])
                    + (f" +{len(new) - 3} more" if len(new) > 3 else ""))
    if notices:
        bits.append(plural(len(notices), "change"))
    subject = " · ".join(bits)
    text = "\n\n".join([text_notice(n) for n in notices] + [text_card(e, True) for e in new]) + TEXT_FOOTER
    sub = ", ".join(x for x in [plural(len(new), "new big event") if new else "",
                                plural(len(notices), "change") if notices else ""] if x)
    html = html_page("Coming up", sub,
                     "".join(html_notice(n) for n in notices) + "".join(html_card(e, True) for e in new))
    return (subject, text, html), new


def tomorrow_events(events, today):
    t = (today + timedelta(days=1)).isoformat()
    return t, [e for e in events if e["date"] == t]


def day_before_email(events, today):
    t, items = tomorrow_events(events, today)
    if not items:
        return t, None
    items.sort(key=lambda e: (e.get("window_start") or e.get("start") or "99:99"))
    if len(items) == 1:
        e = items[0]
        subject = f"Tomorrow: {short_title(e)} · pickup {e['window']}"
    else:
        subject = f"Tomorrow {nice_date(t)}: {plural(len(items), 'event')} · " + ", ".join(short_title(e) for e in items[:3])
    text = "\n\n".join(text_card(e) for e in items) + TEXT_FOOTER
    html = html_page(f"Tomorrow · {nice_date(t)}", plural(len(items), "event"),
                     "".join(html_card(e) for e in items))
    return t, (subject, text, html)


def send(subject, text, html, dry_run, html_out=None):
    if html_out:
        Path(html_out).write_text(html)
    if dry_run:
        print(f"--- DRY RUN ---\nSubject: {subject}\n\n{text}")
        return
    user = os.environ["GMAIL_ADDRESS"]
    msg = EmailMessage()
    msg["From"] = f"Miami Ride Radar <{user}>"
    msg["To"] = os.environ.get("ALERT_TO") or user
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s:
        s.login(user, os.environ["GMAIL_APP_PASSWORD"])
        s.send_message(msg)
    print(f"sent: {subject}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["advance", "day-before", "test", "seed"])
    ap.add_argument("--today")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--html")
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
        send(*email, a.dry_run, a.html)
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
        send(*email, a.dry_run, a.html)
        if not a.dry_run:
            state["day_before_sent"] = sorted(set(state["day_before_sent"]) | {t})[-60:]
            save_state(state)
    else:  # test
        t, email = day_before_email(events, today)
        subject, text, html = email or (f"No events tomorrow {nice_date(t)}", "No tracked events tomorrow." + TEXT_FOOTER,
                                        html_page(f"Tomorrow · {nice_date(t)}", "No tracked events", ""))
        send("[TEST] " + subject, text, html, a.dry_run, a.html)
    return 0


if __name__ == "__main__":
    sys.exit(main())
