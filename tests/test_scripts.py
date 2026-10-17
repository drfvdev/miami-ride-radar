import json
import sys
import unittest
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import alerts  # noqa: E402
import update_events as up  # noqa: E402

TODAY = date(2026, 10, 17)
NOW = datetime(2026, 10, 17, 8, 0, tzinfo=up.TZ)


def ev(id, d, **kw):
    e = {"id": id, "title": id.title(), "date": d, "start": "20:00", "end": "", "end_verified": False,
         "category": "Concert", "area": "Downtown", "venue": "Kaseya Center",
         "address": "601 Biscayne Blvd", "priority": "High", "window": "10:15–11:45 PM",
         "window_type": "rough planning estimate", "note": "", "source": "https://example.com/" + id}
    e.update(kw)
    return e


def prop(id, d, **kw):
    return dict(ev(id, d, **kw), confirmed=True)


def feed(*events):
    return {"updated_at": "x", "timezone": "America/New_York", "events": list(events)}


def ids(out):
    return [e["id"] for e in out["events"]]


class Merge(unittest.TestCase):
    def run_merge(self, events, proposals):
        return up.merge(feed(*events), proposals, TODAY, NOW)

    def test_drops_past_keeps_today_and_overnight(self):
        out, _, _ = self.run_merge([ev("old", "2026-10-16"), ev("today", "2026-10-17"),
                                    ev("late", "2026-10-16", end_date="2026-10-17")], {})
        self.assertEqual(sorted(ids(out)), ["late", "today"])

    def test_sets_updated_at(self):
        out, _, _ = self.run_merge([], {})
        self.assertEqual(out["updated_at"], "2026-10-17T08:00:00-04:00")

    def test_adds_confirmed_skips_unconfirmed(self):
        p = prop("new", "2026-10-25")
        u = dict(ev("rumor", "2026-10-25"), confirmed=False)
        out, _, log = self.run_merge([], {"events": [p, u]})
        self.assertEqual(ids(out), ["new"])
        self.assertNotIn("confirmed", out["events"][0])

    def test_unconfirmed_never_replaces_existing(self):
        old = ev("a", "2026-10-25", venue="Kaseya Center")
        out, _, _ = self.run_merge([old], {"events": [dict(ev("a", "2026-10-26"), confirmed=False)]})
        self.assertEqual(out["events"][0], old)

    def test_keeps_listings_not_found_again(self):
        out, _, _ = self.run_merge([ev("a", "2026-10-25")], {"events": []})
        self.assertEqual(ids(out), ["a"])

    def test_dedupes_by_id_and_by_title_date_venue(self):
        out, _, log = self.run_merge([ev("a", "2026-10-25")],
                                     {"events": [prop("b", "2026-10-26"), prop("b", "2026-10-27"),
                                                 dict(prop("a-dup", "2026-10-25"), title="A")]})
        self.assertEqual(ids(out), ["a", "b"])
        self.assertEqual(out["events"][1]["date"], "2026-10-26")

    def test_verified_end_not_downgraded(self):
        old = ev("a", "2026-10-25", end="23:00", end_verified=True)
        out, _, _ = self.run_merge([old], {"events": [prop("a", "2026-10-25", note="new note")]})
        e = out["events"][0]
        self.assertEqual((e["end"], e["end_verified"], e["note"]), ("23:00", True, "new note"))

    def test_keeps_window_times(self):
        out, _, _ = self.run_merge([], {"events": [prop("a", "2026-10-25", window_start="22:15", window_end="23:45")]})
        self.assertEqual(out["events"][0]["window_end"], "23:45")

    def test_unverified_end_is_blanked(self):
        out, _, _ = self.run_merge([], {"events": [prop("a", "2026-10-25", end="23:00")]})
        self.assertEqual(out["events"][0]["end"], "")

    def test_reschedule_and_cancel_create_notices(self):
        out, notices, _ = self.run_merge(
            [ev("a", "2026-10-25"), ev("b", "2026-10-26")],
            {"events": [prop("a", "2026-11-02")],
             "cancellations": [{"id": "b", "source": "https://example.com/b", "reason": "illness"},
                               {"id": "zzz", "source": "https://x.com"}]})
        self.assertEqual(ids(out), ["a"])
        self.assertEqual(out["events"][0]["date"], "2026-11-02")
        self.assertEqual([n["type"] for n in notices], ["cancelled", "rescheduled"])

    def test_cancellation_needs_source(self):
        out, notices, _ = self.run_merge([ev("b", "2026-10-26")], {"cancellations": [{"id": "b"}]})
        self.assertEqual((ids(out), notices), (["b"], []))

    def test_rejects_bad_proposals(self):
        bad = [prop("x1", "2026-10-25", source="http://insecure"),
               prop("x2", "2026-10-25", window_type="exact time"),
               prop("x3", "25/10/2026"), prop("X 4", "2026-10-25"),
               prop("x6", "2026-10-25", priority="Low"), prop("x7", "2026-10-25", window_start="9pm"),
               {k: v for k, v in prop("x5", "2026-10-25").items() if k != "venue"}]
        out, _, log = self.run_merge([], {"events": bad})
        self.assertEqual(ids(out), [])
        self.assertEqual(sum(l.startswith("skipped") for l in log), 7)

    def test_real_feed_is_valid_schema(self):
        data = json.loads((ROOT / "events.json").read_text())
        for e in data["events"]:
            cleaned, err = up.clean(dict(e, confirmed=True))
            self.assertIsNone(err, e["id"])


class Alerts(unittest.TestCase):
    def test_advance_only_new_high_priority(self):
        events = [ev("a", "2026-10-20"), ev("b", "2026-10-21", priority="Medium"), ev("c", "2026-10-22")]
        state = {"advance_sent": ["c"], "day_before_sent": [], "pending_notices": []}
        email, new = alerts.advance_email(events, state, TODAY)
        self.assertEqual([e["id"] for e in new], ["a"])
        self.assertIn("1 new major event", email[0])

    def test_advance_nothing_new(self):
        state = {"advance_sent": ["a"], "day_before_sent": [], "pending_notices": []}
        self.assertEqual(alerts.advance_email([ev("a", "2026-10-20")], state, TODAY), (None, []))

    def test_advance_includes_notices(self):
        state = {"advance_sent": [], "day_before_sent": [], "pending_notices": [
            {"type": "cancelled", "id": "b", "title": "B", "date": "2026-10-26", "source": "https://x"}]}
        email, _ = alerts.advance_email([], state, TODAY)
        self.assertIn("CANCELLED: B", email[1])

    def test_day_before_lists_end_and_window(self):
        events = [ev("a", "2026-10-18", end="23:00", end_verified=True), ev("b", "2026-10-18"),
                  ev("c", "2026-10-19")]
        t, (subject, body) = alerts.day_before_email(events, TODAY)
        self.assertEqual(t, "2026-10-18")
        self.assertIn("2 events", subject)
        self.assertIn("Official end: 11:00 PM (official)", body)
        self.assertIn("Official end: Not published", body)
        self.assertIn("Pickup window: 10:15–11:45 PM (rough planning estimate)", body)
        self.assertNotIn("C\n", body)

    def test_day_before_none(self):
        self.assertEqual(alerts.day_before_email([], TODAY), ("2026-10-18", None))


if __name__ == "__main__":
    unittest.main()
