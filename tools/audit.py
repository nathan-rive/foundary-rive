#!/usr/bin/env python3
"""World-safety audit for Rive for Foundry.

Lists every line in scripts/ that can change world data, files on the server or
other clients' state (see "World-safety checklist" in CLAUDE.md), and marks the
ones that aren't in the reviewed baseline (tools/audit-reviewed.txt) as NEW.

  python tools/audit.py            list sites; NEW ones need review
  python tools/audit.py --check    exit 1 if anything is NEW (CI)
  python tools/audit.py --accept   record the current sites as reviewed

Sites are keyed by file + the line's text (whitespace-normalised) + occurrence,
not by line number, so unrelated edits don't churn the baseline. Only run
--accept after reviewing every NEW site against the checklist.
"""

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
BASELINE = ROOT / "tools" / "audit-reviewed.txt"

# (label, pattern). Broad on purpose: a false positive costs one review; a miss
# could cost someone's world.
PATTERNS = [
    ("document update", r"\.update\s*\("),
    ("document create", r"\.create\s*\(|createEmbeddedDocuments\s*\("),
    ("document delete", r"\.delete\s*\(|deleteEmbeddedDocuments\s*\("),
    ("pre-hook source edit", r"updateSource\s*\(|setProperty\s*\(\s*changes"),
    ("flag write", r"\bsetFlag\s*\(|\bunsetFlag\s*\("),
    ("setting write", r"settings\.set\s*\("),
    ("file upload / folder", r"FilePicker\.upload|createDirectory\s*\(|\buploadRiv\s*\("),
    ("socket emit", r"socket\.emit\s*\("),
    ("pre-document hook", r"Hooks\.on\(\s*[\"'`]pre[A-Z]"),
    ("network fetch", r"\bfetch\s*\("),
    ("eval / dynamic code", r"\beval\s*\(|new Function\s*\("),
]
COMPILED = [(label, re.compile(rx)) for label, rx in PATTERNS]


def normalise(text):
    return " ".join(text.strip().split())


def scan():
    """Yields (key, path, line_no, label, text) for every matching line."""
    sites = []
    for path in sorted(SCRIPTS.rglob("*.mjs")):
        rel = path.relative_to(ROOT).as_posix()
        seen = {}
        for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            stripped = raw.strip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue
            labels = [label for label, rx in COMPILED if rx.search(raw)]
            if not labels:
                continue
            text = normalise(raw)
            occurrence = seen.get(text, 0)
            seen[text] = occurrence + 1
            digest = hashlib.sha1(f"{rel}\n{text}\n{occurrence}".encode("utf-8")).hexdigest()[:12]
            sites.append((digest, rel, n, ", ".join(labels), text))
    return sites


def load_baseline():
    if not BASELINE.exists():
        return set()
    keys = set()
    for line in BASELINE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            keys.add(line.split()[0])
    return keys


def main(argv):
    sites = scan()
    reviewed = load_baseline()
    current = {s[0] for s in sites}

    if "--accept" in argv:
        lines = [
            "# Reviewed world-safety sites (tools/audit.py --accept).",
            "# key  file  [kinds]  code",
        ]
        lines += [f"{key}  {rel}  [{labels}]  {text}" for key, rel, _, labels, text in sites]
        BASELINE.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"Recorded {len(sites)} reviewed sites in {BASELINE.relative_to(ROOT).as_posix()}.")
        return 0

    new = [s for s in sites if s[0] not in reviewed]
    gone = reviewed - current
    for key, rel, n, labels, text in sites:
        mark = "NEW " if key not in reviewed else "    "
        print(f"{mark}{rel}:{n}  [{labels}]  {text}")
    print()
    print(f"{len(sites)} sites, {len(new)} NEW, {len(gone)} reviewed sites no longer present.")
    if new:
        print("Review every NEW site against the World-safety checklist in CLAUDE.md, then run --accept.")
    if "--check" in argv and (new or gone):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
