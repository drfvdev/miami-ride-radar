# Miami Ride Radar

A phone-first guide to large Miami-Dade events and when their crowds are likely to need rides, for Uber and Lyft drivers.

**Live website:** https://drfvdev.github.io/miami-ride-radar/

## What the site does

- **Today first.** Opens on today's events. Each one leads with the suggested pickup window, then the event, venue, start time and official end time, and one-tap Waze, Google Maps and Details buttons.
- **Live status.** Each window shows "Starts in 2h 15m", "Open now · 40 min left" or "Pickup window passed". Events whose window has passed move to the bottom. Statuses refresh every 30 seconds and roll over at midnight. Last night's events stay on screen until their window closes, so a 4 AM festival exit still shows after midnight.
- **Pickup windows at a glance.** When two or more events share the day, a timeline shows their windows against a "now" marker so overlaps stand out.
- **What's next.** Below today: Tomorrow, This week / This weekend (or Next week / Next weekend), then the next few later events.
- **Upcoming.** Search, area and type filters, 7-day / 30-day / all ranges, and a "High only" toggle.
- **Calendar.** Month view with a dot per event (amber = high opportunity). Tap a day to list its events.
- **Event details.** A bottom sheet with the pickup window (marked as an estimate), start time, official end (or "Not published"), opportunity level, address, traffic notes, Waze / Maps, add-to-calendar (.ics with a 30-minute reminder), share and the official page.
- **Data freshness.** The footer shows when listings were last updated. If the feed is more than 48 hours old, a warning appears at the top.
- **Light and dark themes.** Dark is the default for night driving, unless the phone is set to light. The choice is remembered.
- **Home screen.** Includes a web app manifest and icon for "Add to Home Screen".
- **Links.** `#today`, `#upcoming`, `#calendar` and `#event=<id>` work with the back button and can be shared.

## Status

| Part | State |
|---|---|
| Website (this repo, GitHub Pages) | Working, tested at phone and desktop widths in both themes |
| `events.json` feed | 23 events researched by hand on October 17, 2026, plus automatic updates since |
| Automatic daily feed updates | **Working.** Claude cloud routine, first successful run Oct 17, 2026 ([8b9437e](https://github.com/drfvdev/miami-ride-radar/commit/8b9437e), 2 events added) |
| Advance email alerts | **Working.** Sent "2 new major events" on Oct 17, 2026 after that run ([Action run](https://github.com/drfvdev/miami-ride-radar/actions/runs/39066762572)) |
| Day-before email alerts | **Delivery tested** with a test email on Oct 17, 2026 ([Action run](https://github.com/drfvdev/miami-ride-radar/actions/runs/39066141812)). First scheduled send is Oct 18 |
| Opportunity levels (High/Medium) | Editorial judgment based on venue size and event type, not live demand data |
| Verified rideshare pickup zones | Not built. Directions go to the venue address |

## Event data

The page reads `events.json` on load and when the refresh button is tapped. Fields:

| Field | Meaning |
|---|---|
| `id`, `title`, `date` | Required. `date` is `YYYY-MM-DD` in Miami time |
| `date_end` | Last day of a multi-day event |
| `start` | Scheduled start, `HH:MM` 24-hour |
| `end`, `end_date`, `end_verified` | Official end. Shown only when `end_verified` is `true`. `end_date` marks an end after midnight |
| `window` | Suggested pickup window as text, for example `10:15–11:45 PM` or `10:30 PM–12:15 AM` |
| `window_start`, `window_end` | Optional `HH:MM` 24-hour times. When present they are used instead of parsing `window` |
| `window_type` | How the window was estimated, such as `rough planning estimate` |
| `priority` | `High` or `Medium` |
| `category`, `area`, `venue`, `address`, `note`, `source` | Display details. `source` must be an `https://` link |

Countdowns and the timeline need a window in one of the formats above. Free text such as "Multiple daytime departures" still displays, but without a countdown. An early-morning window for an evening event (for example `3:15–4:30 AM` for a 4 PM festival) is treated as the following night.

A pickup window is an estimate, never a verified departure time or an earnings prediction.

## Automation

Two parts, each with one job:

1. **Daily research (Claude cloud routine).** The routine [Miami Ride Radar daily event update](https://claude.ai/code/routines/trig_01MopH7XRWWHsRKJi1KRtWdb) runs every day at 12:03 UTC (8:03 AM Miami in daylight time, 7:03 AM in standard time) in the claude.ai cloud. Your Mac does not need to be on. It follows [`scripts/RESEARCH.md`](scripts/RESEARCH.md): it researches Miami-Dade events for the next 14 days on official sites, writes its findings as proposals, and runs [`scripts/update_events.py`](scripts/update_events.py), which:
   - accepts only proposals marked confirmed on an `https://` official source
   - keeps official end times (`end_verified`) separate from estimated pickup windows, and never replaces a verified end time with an unverified one
   - deduplicates by `id` (and by same title, date and venue)
   - never removes a listing just because research didn't find it again
   - handles cancellations (removed, with a notice) and reschedules (same `id`, new date, with a notice)
   - drops past events and sets `updated_at`

   Then it commits `events.json` to `main`.
2. **Email alerts (GitHub Action [`alerts.yml`](.github/workflows/alerts.yml)).** It sends through Gmail from and to the `GMAIL_ADDRESS` secret, or to `ALERT_TO` if that's set.
   - **Advance alert:** runs whenever `events.json` changes and once a day. One email covers new High-priority events plus any cancellations and reschedules. Each event is announced once.
   - **Day-before alert:** runs daily at 14:00 UTC (10 AM Miami in daylight time, 9 AM in standard time). It covers tomorrow's events with their official end time (or "Not published") and estimated pickup window. It is sent once per date.
   - What has been sent is recorded in `alerts/state.json`.

**Setup that already exists:** repo secrets `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` (a Gmail app password from myaccount.google.com/apppasswords). The claude.ai cloud environment "Default" has network access set to **Full**, so the routine can open official event sites. With the default "Trusted" level, the routine can't verify anything and makes no changes.

**Check or run by hand**
- Research now: open the routine link above and click **Run now**. Each run's summary lists what it added, updated, skipped and why.
- Test email: GitHub → Actions → Driver alerts → **Run workflow** → mode `test`. Or from a terminal: `gh workflow run alerts.yml -R drfvdev/miami-ride-radar -f mode=test`
- Tests: `python3 -m unittest discover -s tests`
- Preview alerts without sending: `python3 scripts/alerts.py day-before --dry-run`

## Hosting

Static site served from the root of `main` through GitHub Pages. No build step.

- `index.html`: page structure
- `styles.css`: mobile-first layout, light and dark themes
- `app.js`: rendering, filters, calendar, live status, detail sheet
- `events.json`: event data
- `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`: home-screen app icons
- `og-image.jpg`: 1200×630 link-preview image for WhatsApp, iMessage and social apps (tags in `index.html`)

All times are Miami local time.
