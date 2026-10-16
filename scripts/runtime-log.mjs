/**
 * Messages the Rive runtime prints, so the module can tell people about the
 * ones that matter (today: scripts it refused to run).
 *
 * The runtime's WASM binds its error output to `console.error` once, while it
 * starts; there is no option to pass our own. So `startRuntime()` tees
 * `console.error` only while the runtime starts: the runtime keeps the tee,
 * everyone else gets the original back as soon as the runtime has loaded. The
 * tee passes every message on unchanged. (User-approved exception to the
 * Client-safety checklist's "no redefined globals" rule.)
 *
 * The runtime prints a refused script's message synchronously while a file
 * loads, in the same task and just before that file's `onLoad`, even with
 * several files loading at once. So messages wait in `pending` until the end
 * of the task, and the player whose `onLoad` runs next takes them.
 */

/** Rive's web runtimes run only signed scripts; an unsigned one never registers. */
const REFUSED_SCRIPT = /ScriptAsset doesn't have a generator function (.+?)\s*$/;

let pending = [];
let clearScheduled = false;

/**
 * Loads the Rive runtime with the tee in place. Call once, before anything else
 * asks for the runtime (the module's init hook).
 * @returns {Promise} the runtime instance promise, as RuntimeLoader.awaitInstance
 */
export function startRuntime(loader = globalThis.rive.RuntimeLoader) {
  const original = console.error;
  const tee = function (...args) {
    try {
      noteRuntimeMessage(args.map(String).join(" "));
    } catch {
      // Never let our bookkeeping get in the way of an error message.
    }
    return original.apply(this, args);
  };
  console.error = tee;
  const restore = () => {
    // Only undo our own change: someone may have wrapped console.error since.
    if (console.error === tee) console.error = original;
  };
  let started;
  try {
    started = loader.awaitInstance();
  } catch (err) {
    restore();
    throw err;
  }
  return Promise.resolve(started).finally(restore);
}

/** Records one runtime message; exported for tests. */
export function noteRuntimeMessage(text) {
  const match = REFUSED_SCRIPT.exec(String(text));
  if (!match) return;
  pending.push({ kind: "refused-script", name: match[1] });
  if (!clearScheduled) {
    clearScheduled = true;
    // Messages nobody claimed in this task belong to no player we know of.
    setTimeout(() => {
      pending = [];
      clearScheduled = false;
    }, 0);
  }
}

/**
 * Names of scripts the runtime refused while the file now finishing its load
 * was loading. Call first thing in that file's onLoad.
 * @returns {string[]}
 */
export function takeRefusedScripts() {
  const names = [...new Set(pending.filter(m => m.kind === "refused-script").map(m => m.name))];
  pending = [];
  return names;
}
