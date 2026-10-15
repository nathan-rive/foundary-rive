import { MODULE_ID, SAMPLE_RIV, WASM_PATH } from "./constants.mjs";
import { RivePlayer } from "./rive-player.mjs";

/**
 * Phase 0 spikes. Each returns a plain result object so it can be run from the
 * console or a macro: `await game.modules.get("foundry-rive").api.spikes.wasm()`.
 */

/** Is rive.wasm served, and with which content type? */
export async function wasm() {
  const res = await fetch(foundry.utils.getRoute(WASM_PATH), { method: "HEAD" });
  return { status: res.status, contentType: res.headers.get("content-type"), ok: res.headers.get("content-type") === "application/wasm" };
}

/**
 * Can a .riv be uploaded through Foundry's normal upload path?
 * Writes `rive-spike/<name>` into the user data folder (GM only).
 */
export async function upload({ src = SAMPLE_RIV, dir = "rive-spike" } = {}) {
  const result = { extensionListed: "riv" in CONST.UPLOADABLE_FILE_EXTENSIONS };
  const bytes = await (await fetch(src)).blob();
  const file = new File([bytes], src.split("/").pop(), { type: "application/octet-stream" });
  try {
    await FilePicker.createDirectory("data", dir).catch(() => {});
    const response = await FilePicker.upload("data", dir, file, {}, { notify: false });
    result.uploaded = Boolean(response?.path);
    result.response = response;
  } catch (err) {
    result.uploaded = false;
    result.error = String(err?.message ?? err);
  }
  return result;
}

/** Mount and destroy `count` players on detached canvases; the live count must return to its start. */
export async function leak({ count = 100, src = SAMPLE_RIV } = {}) {
  const buffer = await (await fetch(src)).arrayBuffer();
  const before = RivePlayer.live.size;
  const heapBefore = performance.memory?.usedJSHeapSize;
  const started = performance.now();
  for (let i = 0; i < count; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const player = await RivePlayer.mount(canvas, { buffer: buffer.slice(0), autoplay: true });
    player.destroy();
  }
  return {
    count,
    liveBefore: before,
    liveAfter: RivePlayer.live.size,
    ms: Math.round(performance.now() - started),
    heapDeltaMB: heapBefore === undefined ? null : +((performance.memory.usedJSHeapSize - heapBefore) / 1048576).toFixed(1)
  };
}

/** Is Foundry's own scene canvas still alive after Rive work? */
export function sceneContext() {
  const gl = canvas?.app?.renderer?.gl;
  return { hasSceneGL: Boolean(gl), contextLost: gl ? gl.isContextLost() : null };
}

/** Run every spike that doesn't need a human. */
export async function all() {
  return { module: game.modules.get(MODULE_ID)?.version, wasm: await wasm(), upload: await upload(), leak: await leak(), sceneContext: sceneContext() };
}
