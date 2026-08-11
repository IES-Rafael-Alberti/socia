from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "verify_workflow.py"
SPEC = importlib.util.spec_from_file_location("verify_workflow", SCRIPT)
assert SPEC and SPEC.loader
verify_workflow = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = verify_workflow
SPEC.loader.exec_module(verify_workflow)


def workflow(body_pattern: str = "needle") -> dict:
    return {
        "case": {"id": "test", "title": "Test", "description": "Test"},
        "variables": {"host": "example.test"},
        "context": {"tools": {}, "pedagogy": {"phase": "Test"}, "notes": ""},
        "phases": [
            {
                "id": "phase",
                "title": "Phase",
                "description": "Test",
                "order": 1,
                "tool_hosts": ["{{host}}"],
                "milestones": [
                    {
                        "id": "first",
                        "label": "First",
                        "network_signature": {
                            "method": "POST",
                            "url_contains": ["/wrong", "/first"],
                            "host_contains": "{{host}}",
                            "response_status": [201],
                            "request_body_contains": body_pattern,
                        },
                    },
                    {
                        "id": "second",
                        "label": "Second",
                        "depends_on": ["first"],
                        "network_signature": {
                            "method": "PATCH",
                            "url_contains": "/second",
                            "host_contains": "{{host}}",
                            "response_status": [204],
                        },
                    },
                ],
            }
        ],
    }


def events(redactions: list[str] | None = None) -> list[dict]:
    return [
        {
            "t": 10,
            "method": "POST",
            "url": "https://example.test/first",
            "host": "example.test",
            "status": 201,
            "requestBody": '{"value":"needle"}',
            "responseBody": "{}",
            "requestBodyRedactions": redactions or [],
            "responseBodyRedactions": [],
            "outcome": "completed",
        },
        {
            "t": 20,
            "method": "PATCH",
            "url": "https://example.test/second",
            "host": "example.test",
            "status": 204,
            "requestBody": None,
            "responseBody": None,
            "requestBodyRedactions": [],
            "responseBodyRedactions": [],
            "outcome": "completed",
        },
    ]


class VerifyWorkflowTests(unittest.TestCase):
    def test_matches_url_arrays_as_or_and_replays_dependencies(self) -> None:
        data = workflow()
        milestones = verify_workflow.milestone_list(data)
        self.assertTrue(verify_workflow.matches(events()[0], milestones[0], data["variables"]))

        completed: set[str] = set()
        for event in events():
            for milestone in milestones:
                if milestone["id"] not in completed and verify_workflow.dependencies_met(
                    milestone, completed
                ) and verify_workflow.matches(event, milestone, data["variables"]):
                    completed.add(milestone["id"])
        self.assertEqual(completed, {"first", "second"})

    def test_reads_a_mentora_zip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "recording.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("recording/network-log.json", json.dumps(events()))
                archive.writestr("recording/metadata.json", json.dumps({"captureWarnings": []}))
            capture = verify_workflow.load_capture(archive_path)
        self.assertEqual(len(capture.events), 2)
        self.assertEqual(capture.metadata, {"captureWarnings": []})

    def test_finds_redacted_fields_used_by_a_signature(self) -> None:
        event = events(["$.password"])[0]
        self.assertEqual(verify_workflow.redacted_fields(event, "request"), {"password"})
        self.assertEqual(verify_workflow.pattern_names('"password"'), {"password"})

    def test_matches_any_complete_signature_alternative(self) -> None:
        data = workflow()
        current = data["phases"][0]["milestones"][0]
        single = current.pop("network_signature")
        current["network_signatures"] = [
            {
                "method": "GET",
                "url_contains": "/current-user",
                "host_contains": "{{host}}",
                "response_status": [200],
            },
            single,
        ]

        self.assertTrue(verify_workflow.matches(events()[0], current, data["variables"]))
        self.assertFalse(
            verify_workflow.matches_signature(
                events()[0], current["network_signatures"][0], current, data["variables"]
            )
        )

    def test_distinguishes_requests_that_share_a_timestamp(self) -> None:
        data = workflow()
        current_events = events()
        current_events[0]["t"] = 10
        current_events[0]["requestId"] = "request-first"
        current_events[1]["t"] = 10
        current_events[1]["requestId"] = "request-second"

        completed, replayed, completed_by_event = verify_workflow.replay_milestones(
            current_events,
            verify_workflow.milestone_list(data),
            data["variables"],
        )

        self.assertEqual(completed, {"first", "second"})
        self.assertEqual(replayed, {"first": 0, "second": 1})
        self.assertEqual(completed_by_event, {0: ["first"], 1: ["second"]})

    def test_reports_two_milestones_completed_by_one_event(self) -> None:
        data = workflow()
        first, second = data["phases"][0]["milestones"]
        second["network_signature"] = json.loads(json.dumps(first["network_signature"]))
        current_event = events()[0]
        current_event["requestId"] = "shared-request"

        completed, replayed, completed_by_event = verify_workflow.replay_milestones(
            [current_event],
            verify_workflow.milestone_list(data),
            data["variables"],
        )

        self.assertEqual(completed, {"first", "second"})
        self.assertEqual(replayed, {"first": 0, "second": 0})
        self.assertEqual(completed_by_event, {0: ["first", "second"]})

    def test_detects_a_signature_match_before_activation(self) -> None:
        data = workflow()
        current_events = [events()[1], events()[0], events()[1].copy()]
        current_events[0]["t"] = 5
        current_events[0]["requestId"] = "second-before-first"
        current_events[1]["t"] = 10
        current_events[1]["requestId"] = "first"
        current_events[2]["t"] = 20
        current_events[2]["requestId"] = "second-after-first"
        milestones = verify_workflow.milestone_list(data)
        independent_indices = {
            milestone["id"]: [
                event_index
                for event_index, event in enumerate(current_events)
                if verify_workflow.matches(event, milestone, data["variables"])
            ]
            for milestone in milestones
        }

        _, replayed, _ = verify_workflow.replay_milestones(
            current_events, milestones, data["variables"]
        )

        self.assertEqual(independent_indices["second"], [0, 2])
        self.assertEqual(replayed["second"], 2)
        self.assertEqual(
            verify_workflow.early_match_events(independent_indices, replayed),
            {"second": (0, 2)},
        )


if __name__ == "__main__":
    unittest.main()
