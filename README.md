# Miami Ride Radar

A phone-first calendar of Miami-Dade events and potential rideshare pickup windows for Uber and Lyft.

**Live website:** https://drfvdev.github.io/miami-ride-radar/

## Features

- **Today first:** The homepage immediately shows today's tracked events, official schedule details and clearly labeled pickup estimates
- **Upcoming:** Search and filter by event name, venue, neighborhood or category, with 7-day, 30-day and all-date options
- **Calendar:** Browse dates, view event indicators and open the day's details
- **Designed for phones:** Touch-friendly cards and fixed mobile bottom navigation
- **Light and dark modes:** A toggle in the header, saved in the browser
- **Driver actions:** Directions and event source links

## Event data

The page reads `events.json` when it opens or when the user taps refresh. The feed's `updated_at` timestamp is shown where appropriate.

The starting feed was curated on October 17, 2026. A separate monitoring schedule is configured to research and attempt to update the JSON, but verify its successful runs before claiming that the listing is continuously up to date.

A pickup window is an estimate, never a verified departure time or an earnings prediction. Official ending times appear only where verified.

## Hosting

The static site is deployed from the root of the `main` branch through GitHub Pages. Website source files:

- `index.html`, page structure
- `styles.css`, responsive light/dark visual design
- `app.js`, filters, calendar and event interactions
- `events.json`, updatable event data

All times are represented in Miami local time.
