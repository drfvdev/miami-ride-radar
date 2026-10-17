# Daily event research (instructions for the Claude cloud routine)

You keep `events.json` for Miami Ride Radar, a calendar for an Uber/Lyft driver in Miami-Dade.
Work in this repository on branch `main`. All times are Miami local time (America/New_York).

## 1. Research

Find events in Miami-Dade from today through the next 14 days that create big rideshare demand:
- Concerts and shows at Kaseya Center, Hard Rock Stadium, loanDepot park, FPL Solutions Amphitheater
  (Bayfront Park), Fillmore Miami Beach, James L. Knight Center, Adrienne Arsht Center, LIV/Club Space-scale
  nightlife events only if they are major ticketed specials
- Miami HEAT home games (nba.com/heat), Miami Dolphins home games (miamidolphins.com),
  Inter Miami / Hurricanes / Marlins home games when in season
- Festivals, conventions at Miami Beach Convention Center, large special events (boat show, Art Basel, F1, etc.)

Also re-check every event already in `events.json` dated within the next 14 days: is it still on, same date,
same start time? Has an official end time been published?

Use official sources (venue, team, league, promoter, ticketing pages). A listing only counts as confirmed
when an official page shows its date. Do not invent times. Never treat a rumor, aggregator or forum post as
confirmed.

## 2. Write proposals

Write `/tmp/proposals.json` (outside the repo):

```json
{
  "events": [ {
    "id": "kebab-case-unique-id",          // reuse the existing id when updating an event
    "title": "...", "date": "YYYY-MM-DD", "date_end": "YYYY-MM-DD (multi-day only)",
    "start": "HH:MM or empty", "end": "HH:MM only if officially published, else empty",
    "end_date": "YYYY-MM-DD only if the official end is after midnight",
    "end_verified": true/false,             // true ONLY when the official end time is on an official page
    "category": "Concert|Sports|Festival|Convention|Special event",
    "area": "Downtown|Miami Beach|Miami Gardens|Wynwood|Little Havana|Coconut Grove|...",
    "venue": "...", "address": "street, city, FL zip",
    "priority": "High|Medium",                 // High = arena/stadium/major festival crowds
    "window": "e.g. 10:15–11:45 PM",        // your estimate of when riders leave
    "window_start": "HH:MM", "window_end": "HH:MM",  // same window in 24-hour time, when you have one
    "window_type": "rough planning estimate", // or "estimated pickup window" / "unverified timing"
    "note": "short driver tip: closures, rideshare zones, crowd size",
    "source": "https://official page",
    "confirmed": true
  } ],
  "cancellations": [ { "id": "existing-id", "source": "https://official notice", "reason": "..." } ]
}
```

Include every confirmed event you found or re-checked (new and existing). Leave out anything you could not
confirm; the script keeps existing listings it does not hear about. For a rescheduled event keep its id and
give the new date. Only list a cancellation when an official source says it is cancelled.

## 3. Merge, check, commit

```bash
python3 scripts/update_events.py /tmp/proposals.json
python3 -m unittest discover -s tests
```

The script drops past events, deduplicates, protects verified end times, rejects unconfirmed or malformed
entries, queues cancellation/reschedule notices for the alert email, and sets `updated_at`.
Read its output; if it skipped something you believe is valid, fix the proposal and rerun.

If the tests pass, commit only `events.json` and `alerts/state.json` (if changed) with the message
`Update events YYYY-MM-DD: <n> added, <n> updated, <n> removed` and push to `main`
(`git pull --rebase` first if the push is rejected). Do not edit any other file. Do not send email yourself:
the GitHub Action "Driver alerts" emails new major events when `events.json` changes.

Finish with a short summary: events added, updated, cancelled/rescheduled, skipped (and why), and the commit hash.
