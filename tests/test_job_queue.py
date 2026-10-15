import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from solver import job_queue


class JobQueueTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.patches = [
            patch.object(job_queue, "ROOT", root),
            patch.object(job_queue, "JOB_PATH", root / ".collector-job.json"),
            patch.object(job_queue, "LOCK_PATH", root / ".collector-job.lock"),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_worker_claim_progress_and_finish(self):
        with self.assertRaises(RuntimeError):
            job_queue.enqueue(3)
        self.assertIsNone(job_queue.claim())
        queued = job_queue.enqueue(3)
        self.assertTrue(queued["running"])
        self.assertEqual(queued["phase"], "queued")
        with self.assertRaises(ValueError):
            job_queue.enqueue(1)
        claimed = job_queue.claim()
        self.assertEqual(claimed["rounds"], 3)
        self.assertIsNone(job_queue.claim())
        self.assertTrue(job_queue.event(claimed["job_id"], {
            "type": "log", "line": "[✓] Раунд 1 завершен за 10с. Новых: 2",
        }))
        self.assertEqual(job_queue.snapshot()["completed_rounds"], 1)
        self.assertFalse(job_queue.event("0" * 32, {"type": "finish", "returncode": 0}))
        job_queue.event(claimed["job_id"], {"type": "finish", "returncode": 0})
        state = job_queue.snapshot()
        self.assertFalse(state["running"])
        self.assertEqual(state["returncode"], 0)
        self.assertNotIn("job_id", state)

    def test_stale_worker_releases_job(self):
        job_queue.claim()
        job_queue.enqueue(1)
        with patch.object(job_queue.time, "time", return_value=job_queue.time.time() + 60):
            state = job_queue.snapshot()
        self.assertEqual(state["returncode"], 3)
        self.assertFalse(state["running"])


if __name__ == "__main__":
    unittest.main()
