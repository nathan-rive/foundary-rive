import assert from "./assert.mjs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source files must be plain text. Shell-escaping slips have twice turned a
 * backslash escape into a control character (`\1` into U+0001, `\b` into a
 * backspace), silently breaking a regular expression.
 */
const root = fileURLToPath(new URL("..", import.meta.url));

async function* files(dir, test) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path, test);
    else if (test(entry.name)) yield path;
  }
}

export const tests = [
  ["no control characters in scripts, tests, tools or lang files", async () => {
    const bad = [];
    const sources = [
      files(join(root, "scripts"), n => n.endsWith(".mjs")),
      files(join(root, "tests"), n => n.endsWith(".mjs")),
      files(join(root, "tools"), n => n.endsWith(".py")),
      files(join(root, "lang"), n => n.endsWith(".json"))
    ];
    for (const list of sources) {
      for await (const path of list) {
        const text = await readFile(path, "utf8");
        // Tab, newline and carriage return are fine; nothing else below U+0020.
        const match = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.exec(text);
        if (match) bad.push(`${path.slice(root.length)} (U+${match[0].charCodeAt(0).toString(16).padStart(4, "0")})`);
      }
    }
    assert.equal(bad.join(", "), "");
  }]
];
