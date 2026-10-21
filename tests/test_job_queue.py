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
            "type": "log",
            "line": "Azure datubāze atbilst vietējai kopijai. Atjauniniet lapu, lai redzētu izmaiņas.",
        }))
        self.assertEqual(
            job_queue.snapshot()["message"],
            "Azure datubāze atbilst vietējai kopijai. Atjauniniet lapu, lai redzētu izmaiņas.",
        )
        self.assertTrue(job_queue.event(claimed["job_id"], {
            "type": "log", "line": "[✓] Kārta 1/3 pabeigta 10 sekundēs. Jauni jautājumi: 2",
        }))
        progress = job_queue.snapshot()
        self.assertEqual(progress["completed_rounds"], 1)
        self.assertEqual(progress["message"], "[✓] Kārta 1/3 pabeigta 10 sekundēs. Jauni jautājumi: 2")
        self.assertFalse(job_queue.event("0" * 32, {"type": "finish", "returncode": 0}))
        job_queue.event(claimed["job_id"], {"type": "finish", "returncode": 0})
        state = job_queue.snapshot()
        self.assertFalse(state["running"])
        self.assertEqual(state["returncode"], 0)
        self.assertIn("Datubāze vietnē ir atjaunināta", state["message"])
        self.assertNotIn("job_id", state)

    def test_reports_latvian_worker_status_messages(self):
        empty = job_queue.empty_state()
        self.assertEqual(empty["message"], "Gaida datora palīgprogrammu.")

        status = job_queue.snapshot()
        self.assertIn("Datora palīgprogramma nav savienota", status["message"])
        with self.assertRaisesRegex(RuntimeError, "Ieslēdziet palīgprogrammu"):
            job_queue.enqueue(1)

    def test_stale_worker_releases_job(self):
        job_queue.claim()
        job_queue.enqueue(1)
        with patch.object(job_queue.time, "time", return_value=job_queue.time.time() + 60):
            state = job_queue.snapshot()
        self.assertEqual(state["returncode"], 3)
        self.assertFalse(state["running"])


if __name__ == "__main__":
    unittest.main()
