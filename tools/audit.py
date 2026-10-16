#!/usr/bin/env python3
"""World- and client-safety audit for Rive for Foundry.

Lists every line in scripts/ that can change world data, files on the server or
other clients' state (kinds marked "world": see "World-safety checklist" in
CLAUDE.md), or that changes or hooks into Foundry's own canvas objects, sheets
and lifecycle (kinds marked "client": see "Client-safety checklist"), and marks
the ones that aren't in the reviewed baseline (tools/audit-reviewed.txt) as NEW.

  python tools/audit.py              list sites; NEW ones need review
  python tools/audit.py --check      exit 1 if anything is NEW or the self-test fails (CI)
  python tools/audit.py --accept     record the current sites as reviewed
  python tools/audit.py --self-test  check every pattern still matches its examples

Sites are keyed by file + the line's text (whitespace-normalised) + occurrence,
not by line number, so unrelated edits don't churn the baseline. Only run
--accept after reviewing every NEW site against the checklists.
"""

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
BASELINE = ROOT / "tools" / "audit-reviewed.txt"

# (label, pattern, examples it must match). Broad on purpose: a false positive
# costs one review; a miss could cost someone's world, or leave their canvas
# unusable (a destroyed Rive texture still held by a tile once broke tile
# selection for a whole scene). The examples guard the patterns themselves: a
# pattern that silently stops matching hides every site it was meant to catch.
PATTERNS = [
    # World: data, files and other clients (World-safety checklist).
    ("world: document update", r"\.update\s*\(", ["doc.update({})"]),
    ("world: document create", r"\.create\s*\(|createEmbeddedDocuments\s*\(", ["Tile.create(data)", "scene.createEmbeddedDocuments('Tile', [])"]),
    ("world: document delete", r"\.delete\s*\(|deleteEmbeddedDocuments\s*\(", ["doc.delete()", "scene.deleteEmbeddedDocuments('Tile', ids)"]),
    ("world: pre-hook source edit", r"updateSource\s*\(|setProperty\s*\(\s*changes", ["doc.updateSource({})", "foundry.utils.setProperty(changes, 'a', 1)"]),
    ("world: flag write", r"\bsetFlag\s*\(|\bunsetFlag\s*\(", ["doc.setFlag('m', 'k', 1)", "doc.unsetFlag('m', 'k')"]),
    ("world: setting write", r"settings\.set\s*\(", ["game.settings.set('m', 'k', 1)"]),
    ("world: file upload / folder", r"FilePicker\.upload|createDirectory\s*\(|\buploadRiv\s*\(", ["FilePicker.upload(a)", "FilePicker.createDirectory(a)", "await uploadRiv(file)"]),
    ("world: socket emit", r"socket\.emit\s*\(", ["game.socket.emit(CHANNEL, msg)"]),
    ("world: pre-document hook", r"Hooks\.on\(\s*[\"'`]pre[A-Z]", ["Hooks.on(\"preCreateTile\", fn)"]),
    ("world: network fetch", r"\bfetch\s*\(", ["await fetch(src)"]),
    ("world: eval / dynamic code", r"\beval\s*\(|new Function\s*\(", ["eval(code)", "new Function('return 1')"]),
    # Client: Foundry's own objects and lifecycle (Client-safety checklist).
    ("client: core object property", r"\.(texture|mesh|renderable|visible|eventMode|interactiveChildren|hitArea)\s*=(?!=)",
     ["placeable.texture = t", "placeable.mesh.texture = t", "layer.renderable = false", "obj.eventMode = 'none'"]),
    ("client: destroy", r"\.destroy\s*\(", ["texture.destroy(true)", "player?.destroy()"]),
    ("client: canvas lifecycle hook", r"Hooks\.(on|once)\(\s*[\"'`](draw|refresh|destroy|canvas|tearDown)",
     ["Hooks.on(`draw${kind}`, fn)", "Hooks.on(\"canvasTearDown\", fn)", "Hooks.once('canvasReady', fn)"]),
    ("client: sheet / HUD render hook", r"Hooks\.(on|once)\(\s*[\"'`]render", ["Hooks.on(`render${sheet}`, fn)", "Hooks.on(\"renderTokenHUD\", fn)"]),
    ("client: canvas ticker", r"ticker\.(add|remove)\s*\(", ["canvas.app.ticker.add(tick)"]),
    ("client: core patch", r"\.prototype\.\w+\s*=(?!=)|\blibWrapper\b|Object\.defineProperty\(\s*(globalThis|window|CONFIG|foundry|PIXI|canvas)\b",
     ["Tile.prototype.draw = fn", "libWrapper.register(a)", "Object.defineProperty(CONFIG, 'x', {})"]),
    ("client: page-level DOM", r"document\.body\.(append|prepend|insertBefore|appendChild)|\bhost\(\)\.append",
     ["document.body.append(el)", "host().append(source)"]),
]
COMPILED = [(label, re.compile(rx)) for label, rx, _ in PATTERNS]


def self_test():
    """Returns a list of problems: patterns that miss their own examples or hold control characters."""
    problems = []
    for label, rx, examples in PATTERNS:
        if any(ord(c) < 32 for c in rx):
            problems.append(f"{label}: pattern contains a control character (a lost backslash?)")
        compiled = re.compile(rx)
        for example in examples:
            if not compiled.search(example):
                problems.append(f"{label}: doesn't match its example {example!r}")
    return problems


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
    problems = self_test()
    for problem in problems:
        print(f"SELF-TEST FAILED  {problem}")
    if "--self-test" in argv:
        print("Self-test passed." if not problems else f"{len(problems)} self-test problem(s).")
        return 1 if problems else 0
    if problems and "--accept" in argv:
        print("Fix the patterns before recording a review.")
        return 1

    sites = scan()
    reviewed = load_baseline()
    current = {s[0] for s in sites}

    if "--accept" in argv:
        lines = [
            "# Reviewed world- and client-safety sites (tools/audit.py --accept).",
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
        print("Review every NEW site against the World-safety (world: kinds) and Client-safety (client: kinds) checklists in CLAUDE.md, then run --accept.")
    if "--check" in argv and (new or gone or problems):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
