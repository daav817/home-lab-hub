"""Run: python -m unittest platform/cameras/manifests/clip-keeper/test_clip_logic.py"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from clip_logic import (  # noqa: E402
    StoredClip, clip_path, clip_window, display_name, doorbell_clip_id, doorbell_window, evictions,
    path_time, wanted_labels,
)


class Window(unittest.TestCase):
    def test_short_detection_padded_to_minimum(self):
        self.assertEqual(clip_window(100, 101), (95, 106))  # 11 s: 5 before, 5 after

    def test_very_short_detection_gets_ten_seconds(self):
        self.assertEqual(clip_window(100, 100), (95, 105))

    def test_long_detection_capped_at_sixty(self):
        self.assertEqual(clip_window(100, 300), (95, 155))

    def test_ongoing_detection_cut_at_sixty(self):
        self.assertEqual(clip_window(100, None), (95, 155))

    def test_overlap_with_earlier_clip_continues_after_it(self):
        self.assertEqual(clip_window(100, 140, covered_until=120), (120, 145))

    def test_overlap_still_at_least_ten_seconds(self):
        self.assertEqual(clip_window(100, 101, covered_until=100), (100, 110))

    def test_fully_covered_is_skipped(self):
        self.assertIsNone(clip_window(100, 101, covered_until=105))


class Eviction(unittest.TestCase):
    def test_oldest_ungrouped_first(self):
        clips = [StoredClip("a", 1, 40, None), StoredClip("b", 2, 40, "Keep"), StoredClip("c", 3, 40, None)]
        self.assertEqual(evictions(clips, 80), (["a"], False))

    def test_grouped_never_deleted(self):
        clips = [StoredClip("a", 1, 60, "Keep"), StoredClip("b", 2, 60, "Keep")]
        self.assertEqual(evictions(clips, 100), ([], True))

    def test_under_limit_nothing_to_do(self):
        self.assertEqual(evictions([StoredClip("a", 1, 10, None)], 100), ([], False))


class Doorbell(unittest.TestCase):
    def test_window_covers_the_wake_up(self):
        self.assertEqual(doorbell_window(1000), (995, 1090))

    def test_first_press_gets_a_new_clip(self):
        self.assertEqual(doorbell_clip_id(1000.7, None), ("doorbell-1000", True))

    def test_quick_second_press_shares_the_clip(self):
        self.assertEqual(doorbell_clip_id(1030, (1000, "doorbell-1000")), ("doorbell-1000", False))

    def test_later_press_gets_its_own_clip(self):
        self.assertEqual(doorbell_clip_id(1070, (1000, "doorbell-1000")), ("doorbell-1070", True))


class Naming(unittest.TestCase):
    def test_labels_filtered_and_sorted(self):
        self.assertEqual(wanted_labels(["person", "bicycle", "car", "person"], {"person", "car", "dog"}), ["car", "person"])

    def test_path(self):
        path = clip_path("garage", 1794271018.2, ["person"], "1794271018.201965-03quzc", "America/New_York")
        self.assertEqual(path, "garage/2026-11-09/193658_person_03quzc.mp4")

    def test_path_time_round_trip(self):
        path = clip_path("garage", 1794271018.0, ["person"], "x-abc", "America/New_York")
        self.assertEqual(path_time(path, "America/New_York"), 1794271018.0)
        self.assertIsNone(path_time("garage/other.mp4", "America/New_York"))

    def test_display_name(self):
        self.assertEqual(display_name("parking_lot_live"), "Parking Lot")
        self.assertEqual(display_name("garage"), "Garage")


if __name__ == "__main__":
    unittest.main()
