# Miami Ride Radar

A phone-first calendar of Miami-Dade events and potential rideshare pickup windows for Uber and Lyft.

**Live website:** https://drfvdev.github.io/miami-ride-radar/

## Features

- **Next pickup:** A live countdown to the next pickup window, which turns green with a "closes in" timer while a window is open
- **Tonight's timeline:** Today's pickup windows on one time axis with a "now" marker, so overlapping or back-to-back pickups are easy to spot
- **Live status on every card:** "Pickups in 2h 15m", "Window open", or "Pickup window passed" (passed events drop to the bottom); refreshes every 30 seconds and rolls over at midnight
- **Today first:** The homepage immediately shows today's tracked events, official schedule details and clearly labeled pickup estimates
- **Upcoming:** Search and filter by event name, venue, neighborhood or category, with 7-day, 30-day and all-date options
- **Calendar:** Browse dates, view event indicators and open the day's details
- **Designed for phones:** Touch-friendly cards and fixed mobile bottom navigation
- **Light and dark modes:** A toggle in the header, saved in the browser
- **Driver actions:** Waze and Google Maps navigation, add the pickup window to your calendar (.ics with a 30-minute reminder), share an event link, and the official event page
- **Shareable links:** `#today`, `#upcoming`, `#calendar` and `#event=<id>` work with the back button and can be sent to other drivers
- **Add to home screen:** Includes a web app manifest and icon

## Event data

The page reads `events.json` when it opens or when the user taps refresh. The feed's `updated_at` timestamp is shown where appropriate.

The starting feed was curated on October 17, 2026. A separate monitoring schedule is configured to research and attempt to update the JSON, but verify its successful runs before claiming that the listing is continuously up to date.

Countdowns and the timeline read the `window` text when it follows the pattern `10:15–11:45 PM` or `10:30 PM–12:15 AM`. Free-text windows such as "Multiple daytime departures" still display, but without a countdown. An early-morning window for an evening event (for example `3:15–4:30 AM` for a 4 PM festival) is treated as the following night.

A pickup window is an estimate, never a verified departure time or an earnings prediction. Official ending times appear only where verified.

## Hosting

The static site is deployed from the root of the `main` branch through GitHub Pages. Website source files:

- `index.html`, page structure
- `styles.css`, responsive light/dark visual design
- `app.js`, filters, calendar and event interactions
- `events.json`, updatable event data
- `manifest.webmanifest` and `icon.svg`, home-screen app icon

All times are represented in Miami local time.
