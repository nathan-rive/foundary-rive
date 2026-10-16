/**
 * Runs every tests/*.test.mjs suite: `node tests/run.mjs`.
 * Each suite exports `tests`: an array of [name, async fn]. A test fails by throwing.
 */
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import "./setup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const files = (await readdir(here)).filter(f => f.endsWith(".test.mjs")).sort();

let passed = 0;
let failed = 0;
for (const file of files) {
  const { tests } = await import(pathToFileURL(join(here, file)).href);
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log(`  ok    ${file} › ${name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${file} › ${name}\n        ${err?.stack ?? err}`);
    }
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
