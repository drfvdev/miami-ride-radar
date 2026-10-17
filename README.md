# Miami Ride Radar

Mobile-friendly calendar for Miami-area events that could create rideshare pickup opportunities for Uber and Lyft drivers.

**Website:** https://drfvdev.github.io/miami-ride-radar/

## Features

- Calendar with upcoming, seven-day, and selected-day views
- Search and filters by neighborhood and event category
- Official event start/end times, with unknown end times clearly indicated
- Estimated pickup focus windows, event details, directions and official source links
- CSV export for listed events

## Event updates

The website reads `events.json` on loading and when you click Refresh. This is **not yet a live automated feed**. The initial 23-event snapshot was researched on October 17, 2026. Keep the data current by updating `events.json`; an email alert alone does not update the website.

An estimated pickup window is not a verified event end time or a guarantee of ride demand or surge pricing.

## Enable free hosting

GitHub repository → **Settings** → **Pages** → **Build and deployment** → **Deploy from a branch** → Branch: **main**; Folder: **/(root)** → **Save**.

GitHub Pages may take a few minutes to publish after being enabled.