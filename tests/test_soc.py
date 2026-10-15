"""Unit tests for the registrar parsing helpers. Run: py -m unittest discover -s tests"""

import pathlib
import tempfile
import unittest

from scraper import build, soc


class MeetingTests(unittest.TestCase):
    def test_in_person_with_instructor(self):
        m = soc.parse_meeting("TH 04:30_PM-07:20_PM Pine Bush 132 Bace,Brianna")
        self.assertEqual(m["days"], ["TH"])
        self.assertEqual((m["start"], m["end"]), ("16:30", "19:20"))
        self.assertEqual(m["location"], "Pine Bush 132")
        self.assertEqual(m["instructor"], "Bace,Brianna")

    def test_tuesday_thursday_without_instructor(self):
        m = soc.parse_meeting("TTH 06:00_PM-07:20_PM Fine Arts 114")
        self.assertEqual(m["days"], ["T", "TH"])
        self.assertEqual(m["location"], "Fine Arts 114")
        self.assertEqual(m["instructor"], "")

    def test_async_online(self):
        m = soc.parse_meeting("12:00_AM-12:00_AM Online Adkins,David")
        self.assertEqual((m["days"], m["start"]), ([], None))
        self.assertEqual((m["location"], m["instructor"]), ("Online", "Adkins,David"))

    def test_synchronous_online(self):
        m = soc.parse_meeting("T 03:00_PM-05:50_PM Online Snyder,Deb")
        self.assertEqual((m["days"], m["start"], m["location"]), (["T"], "15:00", "Online"))

    def test_multi_word_names_and_rooms(self):
        m = soc.parse_meeting("T 06:00_PM-08:50_PM Massry Schl of Business 123 Langlois II,Marshal")
        self.assertEqual(m["location"], "Massry Schl of Business 123")
        self.assertEqual(m["instructor"], "Langlois II,Marshal")
        m = soc.parse_meeting("MW 10:10_AM-11:30_AM Hudson 0110 Jurkowski,Janine")
        self.assertEqual((m["days"], m["location"]), (["M", "W"], "Hudson 0110"))

    def test_noon_and_midnight(self):
        m = soc.parse_meeting("T 12:00_PM-02:50_PM Humanities 127 Jeung,Chanup")
        self.assertEqual((m["start"], m["end"]), ("12:00", "14:50"))

    def test_unknown_format_is_kept(self):
        m = soc.parse_meeting("TBA")
        self.assertFalse(m["parsed"])
        self.assertEqual(m["location"], "TBA")


class SeatTests(unittest.TestCase):
    def test_pools_and_open(self):
        s = soc.parse_seats(
            "Seats Remaining for: DFC-MS-RISKPCC students - 7 Seats Remaining for: Cyber Risk Mgmt & "
            "Cmpl MS conc - 5, Seats Remaining for any students: 20"
        )
        self.assertEqual(s["pools"], [
            {"group": "DFC-MS-RISKPCC students", "seats": 7},
            {"group": "Cyber Risk Mgmt & Cmpl MS conc", "seats": 5},
        ])
        self.assertEqual(s["open"], 20)

    def test_group_names_with_commas_and_hyphens(self):
        s = soc.parse_seats("Seats Remaining for: ISSL, MSIS, IS Cert, & INF-NON - 17, Seats Remaining for any students: 8")
        self.assertEqual(s["pools"], [{"group": "ISSL, MSIS, IS Cert, & INF-NON", "seats": 17}])
        self.assertEqual(s["open"], 8)

    def test_none_means_all_open(self):
        self.assertEqual(soc.parse_seats("None"), {"pools": [], "open": None, "parsed": True})

    def test_reserved_only_means_zero_open(self):
        self.assertEqual(soc.parse_seats("Seats Remaining for: SPH only - 15")["open"], 0)


class ExclusionTests(unittest.TestCase):
    def test_cross_listed_codes(self):
        self.assertEqual(soc.course_codes("Cybr/CEHC/Pad 449"), ["CYBR 449", "CEHC 449", "RPAD 449"])
        self.assertEqual(soc.course_codes("CEHC445/CYBR445"), ["CEHC 445", "CYBR 445"])

    def test_description_rules(self):
        self.assertEqual(soc.excluded_by(
            "Students who have received credit for CYBR453 cannot receive credit for this course.", "CYBR 553"),
            ["CYBR 453"])
        self.assertEqual(soc.excluded_by(
            "Students who receive credit for Cybr 447 cannot receive credit for this course.", "CYBR 547"),
            ["CYBR 447"])
        self.assertEqual(soc.excluded_by(
            "Students who have received credit for CYBR452 cannot receive credit for this course. "
            "Students can only earn credit for CYBR551 or CYBR552.", "CYBR 552"),
            ["CYBR 452", "CYBR 551"])
        self.assertEqual(soc.excluded_by("Covers networking.", "CYBR 503"), [])

    def test_prerequisite(self):
        self.assertEqual(soc.prerequisite("Text. Prerequisite: Completion of 15 graduate credits, consent of advisor."),
                         "Completion of 15 graduate credits, consent of advisor.")
        self.assertEqual(soc.prerequisite("Prerequisite(s): CINF 100."), "CINF 100.")


class BuildTests(unittest.TestCase):
    def test_term_order(self):
        labels = ["Summer 2026", "Spring 2027", "Fall 2026", "Winter 2027"]
        self.assertEqual(sorted(labels, key=build.term_sort_key, reverse=True),
                         ["Spring 2027", "Winter 2027", "Fall 2026", "Summer 2026"])

    def test_repo_programs_file_is_valid(self):
        cfg = build.load_programs(pathlib.Path(__file__).parent.parent / "programs.toml")
        self.assertEqual({p["id"] for p in cfg["programs"]}, {"risk", "health"})

    def test_credit_total_mismatch_is_rejected(self):
        bad = """
[[programs]]
id = "x"
name = "X"
total_credits = 36
seat_groups = []
  [[programs.requirements]]
  id = "core"
  label = "1"
  name = "Core"
  type = "choose"
  credits = 33
  courses = ["CYBR 503"]
  receives_waived_credits = true
"""
        with tempfile.TemporaryDirectory() as d:
            path = pathlib.Path(d) / "p.toml"
            path.write_text(bad, encoding="utf-8")
            with self.assertRaisesRegex(build.ConfigError, "add up to 33"):
                build.load_programs(path)


if __name__ == "__main__":
    unittest.main()
