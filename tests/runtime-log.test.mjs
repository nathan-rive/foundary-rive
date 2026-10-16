import assert from "./assert.mjs";
import { noteRuntimeMessage, startRuntime, takeRefusedScripts } from "../scripts/runtime-log.mjs";

const REFUSED = name => `ScriptAsset doesn't have a generator function ${name}\n`;
const nextTask = () => new Promise(resolve => setTimeout(resolve, 5));

/** Runs fn with console.error replaced by a recorder, restoring it after. */
async function withConsoleError(fn) {
  const original = console.error;
  const seen = [];
  const recorder = (...args) => seen.push(args.join(" "));
  console.error = recorder;
  try {
    await fn(seen, recorder);
  } finally {
    console.error = original;
  }
}

export const tests = [
  ["a refused script is claimed by the file whose onLoad runs next, in the same task", () => {
    takeRefusedScripts();
    noteRuntimeMessage(REFUSED("trap"));
    noteRuntimeMessage(REFUSED("trap"));
    noteRuntimeMessage("something else entirely");
    assert.equal(JSON.stringify(takeRefusedScripts()), JSON.stringify(["trap"]));
    assert.equal(takeRefusedScripts().length, 0); // the next file doesn't inherit them
  }],
  ["messages nobody claims in their task are dropped", async () => {
    takeRefusedScripts();
    noteRuntimeMessage(REFUSED("orphan"));
    await nextTask();
    assert.equal(takeRefusedScripts().length, 0);
  }],
  ["the tee is in place only while the runtime starts, and passes messages on", async () => {
    await withConsoleError(async (seen, recorder) => {
      let release;
      let boundByRuntime = null;
      const loader = {
        awaitInstance() {
          // The runtime binds console.error once, as it starts.
          boundByRuntime = console.error.bind(console);
          return new Promise(resolve => (release = resolve));
        }
      };
      const started = startRuntime(loader);
      assert.equal(console.error === recorder, false); // teed while starting
      release({});
      await started;
      assert.equal(console.error, recorder); // everyone else has the original back
      takeRefusedScripts();
      boundByRuntime(REFUSED("trap"));
      assert.equal(seen.at(-1).includes("ScriptAsset"), true); // passed on unchanged
      assert.equal(JSON.stringify(takeRefusedScripts()), JSON.stringify(["trap"])); // and noted
    });
  }],
  ["a wrapper someone added meanwhile is left alone", async () => {
    await withConsoleError(async () => {
      let release;
      const started = startRuntime({ awaitInstance: () => new Promise(resolve => (release = resolve)) });
      const theirs = () => {};
      console.error = theirs;
      release({});
      await started;
      assert.equal(console.error, theirs);
    });
  }],
  ["a runtime that fails to start still gets console.error restored", async () => {
    await withConsoleError(async (seen, recorder) => {
      let failed = false;
      await startRuntime({ awaitInstance: () => Promise.reject(new Error("no wasm")) }).catch(() => (failed = true));
      assert.equal(failed, true);
      assert.equal(console.error, recorder);
      assert.throws(() => startRuntime({ awaitInstance: () => { throw new Error("sync"); } }));
      assert.equal(console.error, recorder);
    });
  }]
];
