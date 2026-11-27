from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from core import (
    atomic_write_json,
    normalize_queue_manifest,
    plan_segments,
    progress_for_segments,
    resumable_jobs,
)


class SegmentPlanTests(unittest.TestCase):
    def test_requested_durations_are_preserved_by_planned_windows(self):
        for duration in (5, 10, 20, 30, 60):
            with self.subTest(duration=duration):
                plan = plan_segments(duration)
                self.assertGreaterEqual(plan.generated_frames_before_trim, plan.target_frames)
                self.assertEqual(plan.segment_frames, 49)
                self.assertEqual(plan.overlap_frames, 4)
                self.assertGreaterEqual(plan.segment_count, 1)

    def test_invalid_duration_and_window_are_rejected(self):
        for duration in (0, 601, True, 2.5):
            with self.subTest(duration=duration), self.assertRaises(ValueError):
                plan_segments(duration)
        with self.assertRaises(ValueError):
            plan_segments(5, segment_frames=50)

    def test_progress_is_monotonic_and_bounded(self):
        values = [progress_for_segments(i, 5) for i in range(6)]
        self.assertEqual(values[0], 5)
        self.assertEqual(values[-1], 95)
        self.assertEqual(values, sorted(values))


class QueueManifestTests(unittest.TestCase):
    def test_manifest_normalizes_and_rejects_duplicate_ids(self):
        result = normalize_queue_manifest({"jobs": [{"id": "a", "prompt": "move", "output": "a.mp4"}]})
        self.assertEqual(result["engine"], "ella-video-engine-v2")
        self.assertEqual(result["jobs"][0]["status"], "queued")
        with self.assertRaises(ValueError):
            normalize_queue_manifest({"jobs": [
                {"id": "a", "prompt": "x", "output": "a.mp4"},
                {"id": "a", "prompt": "y", "output": "b.mp4"},
            ]})

    def test_completed_jobs_resume_only_when_output_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "done.mp4").write_bytes(b"verified-placeholder")
            (root / "empty.mp4").write_bytes(b"")
            manifest = normalize_queue_manifest({"jobs": [
                {"id": "done", "prompt": "p", "output": "done.mp4", "status": "completed"},
                {"id": "missing", "prompt": "p", "output": "missing.mp4", "status": "queued"},
                {"id": "missing-completed", "prompt": "p", "output": "missing-completed.mp4", "status": "completed"},
                {"id": "empty-completed", "prompt": "p", "output": "empty.mp4", "status": "completed"},
            ]})
            self.assertEqual([j["id"] for j in resumable_jobs(manifest, root)], [
                "missing", "missing-completed", "empty-completed",
            ])
            manifest["jobs"][1]["output"] = "../escape.mp4"
            with self.assertRaises(ValueError):
                list(resumable_jobs(manifest, root))

    def test_json_checkpoint_is_parseable(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "queue.json"
            atomic_write_json(target, {"jobs": []})
            self.assertEqual(json.loads(target.read_text()), {"jobs": []})


if __name__ == "__main__":
    unittest.main()
