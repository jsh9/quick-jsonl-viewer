#!/usr/bin/env python3
"""Generate a large JSONL file with repeated placeholder records."""

import json
from pathlib import Path


REPEAT_COUNT = 200_000
OUTPUT_PATH = Path(__file__).resolve().parent / "large-placeholder.jsonl"

record = {
    "id": "placeholder-id",
    "title": "Placeholder title",
    "description": "Placeholder description text for testing JSONL rendering.",
    "summary": (
        "This placeholder summary is intentionally verbose so each JSONL row is "
        "large enough to exercise scrolling, formatting, and virtualized rendering "
        "without requiring a huge number of distinct records."
    ),
    "author": {
        "name": "Placeholder Name",
        "email": "placeholder@example.com",
        "organization": "Placeholder Organization",
        "department": "Placeholder Department",
        "role": "Placeholder Role",
        "location": {
            "city": "Placeholder City",
            "region": "Placeholder Region",
            "country": "Placeholder Country",
            "timezone": "Placeholder/Timezone",
        },
    },
    "metadata": {
        "source": "placeholder-source",
        "category": "placeholder-category",
        "status": "placeholder-status",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-02T00:00:00.000Z",
        "version": "placeholder-version",
        "checksum": "placeholder-checksum-value",
        "partition": "placeholder-partition",
        "shard": "placeholder-shard",
        "priority": "placeholder-priority",
    },
    "tags": ["placeholder", "jsonl", "sample"],
    "content": {
        "headline": "Placeholder headline for a large generated JSONL record",
        "body": [
            "Placeholder paragraph one with repeated descriptive text for testing.",
            "Placeholder paragraph two with additional content and punctuation.",
            "Placeholder paragraph three with enough words to make the record larger.",
            "Placeholder paragraph four for another block of generated text.",
            "Placeholder paragraph five to extend the payload size.",
            "Placeholder paragraph six to keep easy-view formatting busy.",
            "Placeholder paragraph seven to create a longer plain-text line.",
            "Placeholder paragraph eight with representative nested data.",
        ],
        "notes": {
            "internal": "Placeholder internal note text.",
            "external": "Placeholder external note text.",
            "review": "Placeholder review note text.",
            "qa": "Placeholder QA note text.",
        },
    },
    "events": [
        {
            "type": "placeholder-event-created",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "actor": "placeholder-actor",
            "message": "Placeholder event message for creation.",
        },
        {
            "type": "placeholder-event-updated",
            "timestamp": "2026-01-01T01:00:00.000Z",
            "actor": "placeholder-actor",
            "message": "Placeholder event message for update.",
        },
        {
            "type": "placeholder-event-reviewed",
            "timestamp": "2026-01-01T02:00:00.000Z",
            "actor": "placeholder-reviewer",
            "message": "Placeholder event message for review.",
        },
        {
            "type": "placeholder-event-published",
            "timestamp": "2026-01-01T03:00:00.000Z",
            "actor": "placeholder-publisher",
            "message": "Placeholder event message for publication.",
        },
    ],
    "metrics": {
        "views": 123456,
        "clicks": 7890,
        "conversions": 123,
        "latencyMs": {
            "p50": 12.34,
            "p90": 45.67,
            "p95": 67.89,
            "p99": 123.45,
        },
        "scores": {
            "quality": 0.98,
            "confidence": 0.87,
            "freshness": 0.76,
            "completeness": 0.65,
        },
    },
    "permissions": {
        "owner": "placeholder-owner",
        "readers": [
            "placeholder-reader-one",
            "placeholder-reader-two",
            "placeholder-reader-three",
            "placeholder-reader-four",
        ],
        "writers": [
            "placeholder-writer-one",
            "placeholder-writer-two",
            "placeholder-writer-three",
        ],
        "flags": {
            "isPublic": False,
            "isArchived": False,
            "isLocked": True,
            "requiresReview": True,
        },
    },
    "relatedItems": [
        {
            "id": "placeholder-related-001",
            "kind": "placeholder-kind",
            "label": "Placeholder related item one",
        },
        {
            "id": "placeholder-related-002",
            "kind": "placeholder-kind",
            "label": "Placeholder related item two",
        },
        {
            "id": "placeholder-related-003",
            "kind": "placeholder-kind",
            "label": "Placeholder related item three",
        },
        {
            "id": "placeholder-related-004",
            "kind": "placeholder-kind",
            "label": "Placeholder related item four",
        },
    ],
    "debug": {
        "requestId": "placeholder-request-id",
        "traceId": "placeholder-trace-id",
        "spanId": "placeholder-span-id",
        "environment": "placeholder-environment",
        "featureFlags": [
            "placeholder-feature-alpha",
            "placeholder-feature-beta",
            "placeholder-feature-gamma",
            "placeholder-feature-delta",
        ],
    },
}


def main() -> None:
    line = json.dumps(record, separators=(",", ":"))

    with OUTPUT_PATH.open("w", encoding="utf-8") as output_file:
        for _ in range(REPEAT_COUNT):
            output_file.write(line + "\n")

    print(f"Wrote {REPEAT_COUNT} lines to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
