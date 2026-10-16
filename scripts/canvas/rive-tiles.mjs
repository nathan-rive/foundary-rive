import { MODULE_ID } from "../constants.mjs";
import { RivePlayer } from "../rive-player.mjs";

/**
 * SPIKE (Phase 5): Rive on scene Tiles.
 *
 * A tile with `flags.foundry-rive.src` gets a Rive player drawing into an
 * offscreen canvas. That canvas is the source of a PIXI texture which replaces
 * the tile mesh's texture. The texture is re-uploaded only on frames where Rive
 * actually drew (EventType.Draw), on the canvas ticker.
 *
 * The tile still needs an ordinary texture.src: in v12 a tile without one gets
 * no mesh at all, so the spike uses a placeholder image and swaps the texture
 * after Foundry draws the tile.
 */

/** tile id -> {player, texture, offscreen, dirty, stopListening} */
const bridges = new Map();

/** Counters for measure(). */
const stats = { uploads: 0, uploadMs: 0, draws: 0 };

/** Longest side of the offscreen canvas, in pixels. Bounds per-tile cost. */
const MAX_TEXTURE_SIDE = 512;

export function registerTileBridge() {
  Hooks.on("drawTile", tile => attach(tile));
  Hooks.on("destroyTile", tile => detach(tile.id));
  Hooks.on("refreshTile", tile => {
    // Foundry may restore the placeholder on some refreshes; keep ours on the mesh.
    const bridge = bridges.get(tile.id);
    if (bridge && tile.mesh && tile.mesh.texture !== bridge.texture) tile.mesh.texture = bridge.texture;
  });
  Hooks.on("canvasTearDown", () => [...bridges.keys()].forEach(detach));
}

async function attach(tile) {
  detach(tile.id);
  const src = tile.document.getFlag(MODULE_ID, "src");
  if (!src || !tile.mesh) return;

  const { width, height } = tile.document;
  const scale = Math.min(1, MAX_TEXTURE_SIDE / Math.max(width, height));
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.max(1, Math.round(width * scale));
  offscreen.height = Math.max(1, Math.round(height * scale));
  // The runtime only draws into canvases that are in the page with a real size
  // (a detached canvas advances but never renders). Keep it laid out, invisible,
  // behind everything.
  Object.assign(offscreen.style, {
    position: "fixed", left: "0px", top: "0px",
    width: `${offscreen.width}px`, height: `${offscreen.height}px`,
    opacity: "0", pointerEvents: "none", zIndex: "-1"
  });
  hostElement().append(offscreen);

  const bridge = { player: null, texture: null, offscreen, dirty: false, stopListening: null };
  bridges.set(tile.id, bridge);

  let player;
  try {
    player = await RivePlayer.mount(offscreen, {
      src,
      stateMachine: tile.document.getFlag(MODULE_ID, "stateMachine") || undefined,
      fit: tile.document.getFlag(MODULE_ID, "fit") || "contain",
      offscreen: true
    });
  } catch (err) {
    console.error(`${MODULE_ID} | tile ${tile.id}:`, err);
    bridges.delete(tile.id);
    offscreen.remove();
    return;
  }
  // The tile may have been redrawn or deleted while we loaded.
  if (bridges.get(tile.id) !== bridge || tile.destroyed || !tile.mesh) {
    offscreen.remove();
    return player.destroy();
  }

  bridge.player = player;
  bridge.texture = PIXI.Texture.from(offscreen);
  // EventType.Draw never fires in @rive-app/canvas 2.44, and Advance fires every
  // frame while playing, settled or not; the runtime exposes no "pixels changed"
  // signal. So a playing tile re-uploads every frame Rive advances (worst case).
  const onDraw = () => {
    bridge.dirty = true;
    stats.draws++;
  };
  player.rive.on(globalThis.rive.EventType.Advance, onDraw);
  const upload = () => {
    if (!bridge.dirty) return;
    bridge.dirty = false;
    const t0 = performance.now();
    bridge.texture.baseTexture.update();
    stats.uploadMs += performance.now() - t0;
    stats.uploads++;
  };
  canvas.app.ticker.add(upload, null, PIXI.UPDATE_PRIORITY.HIGH);
  bridge.stopListening = () => {
    canvas.app?.ticker?.remove(upload);
    player.rive?.off(globalThis.rive.EventType.Advance, onDraw);
  };

  tile.texture = bridge.texture;
  tile.mesh.texture = bridge.texture;
  tile.renderFlags.set({ refreshMesh: true });
}

function detach(id) {
  const bridge = bridges.get(id);
  if (!bridge) return;
  bridges.delete(id);
  bridge.stopListening?.();
  bridge.player?.destroy();
  bridge.texture?.destroy(true);
  bridge.offscreen.remove();
}

function hostElement() {
  let host = document.getElementById(`${MODULE_ID}-tile-sources`);
  if (!host) {
    host = document.createElement("div");
    host.id = `${MODULE_ID}-tile-sources`;
    host.setAttribute("aria-hidden", "true");
    document.body.append(host);
  }
  return host;
}

/* -------------------------------------------- */
/*  Spike harness                               */
/* -------------------------------------------- */

const SPIKE_FLAG = "spikeTile";

/** Places `count` Rive tiles in a grid on the viewed scene. */
export async function spawn(count, { src = "rive-spike/vehicles.riv.json", size = 300, placeholder = "icons/svg/d20.svg" } = {}) {
  const scene = canvas.scene;
  const cols = Math.ceil(Math.sqrt(count));
  const { sceneX, sceneY } = canvas.dimensions;
  const data = Array.from({ length: count }, (_, i) => ({
    x: sceneX + (i % cols) * (size + 20),
    y: sceneY + Math.floor(i / cols) * (size + 20),
    width: size,
    height: size,
    texture: { src: placeholder },
    flags: { [MODULE_ID]: { src, [SPIKE_FLAG]: true } }
  }));
  return scene.createEmbeddedDocuments("Tile", data);
}

/** Fires every spike tile's first trigger input repeatedly, so the art keeps moving. */
export function agitate(everyMs = 400) {
  const id = setInterval(() => {
    for (const { player } of bridges.values()) {
      const sm = player?.rive?.playingStateMachineNames?.[0];
      player?.rive?.stateMachineInputs(sm)?.find(i => i.type === 58)?.fire();
    }
  }, everyMs);
  return () => clearInterval(id);
}

/** Removes every tile the spike created on the viewed scene. */
export async function clear() {
  const ids = canvas.scene.tiles.filter(t => t.getFlag(MODULE_ID, SPIKE_FLAG)).map(t => t.id);
  return canvas.scene.deleteEmbeddedDocuments("Tile", ids);
}

/**
 * Samples the scene canvas for `seconds`: frame intervals (fps, p95), time spent
 * in Foundry's render call, and our texture upload count and time.
 */
export async function measure(seconds = 5) {
  const app = canvas.app;
  const frames = [];
  const renders = [];
  const originalRender = app.renderer.render.bind(app.renderer);
  app.renderer.render = (...args) => {
    const t0 = performance.now();
    const out = originalRender(...args);
    renders.push(performance.now() - t0);
    return out;
  };
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    frames.push(now - last);
    last = now;
  };
  app.ticker.add(tick);
  // Time each Rive instance's per-frame draw (advance + rasterize into its canvas).
  let riveMs = 0;
  const unwrap = [];
  for (const { player } of bridges.values()) {
    const r = player?.rive;
    if (!r) continue;
    const original = r.draw;
    r.draw = function (...args) {
      const t0 = performance.now();
      const out = original.apply(this, args);
      riveMs += performance.now() - t0;
      return out;
    };
    unwrap.push(() => (r.draw = original));
  }
  Object.assign(stats, { uploads: 0, uploadMs: 0, draws: 0 });
  await new Promise(r => setTimeout(r, seconds * 1000));
  app.ticker.remove(tick);
  app.renderer.render = originalRender;
  unwrap.forEach(u => u());

  const sorted = [...frames].sort((a, b) => a - b);
  const avg = list => list.reduce((s, x) => s + x, 0) / Math.max(1, list.length);
  return {
    tiles: bridges.size,
    seconds,
    fps: +(1000 / avg(frames)).toFixed(1),
    frameMsP95: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1),
    renderMsAvg: +avg(renders).toFixed(2),
    riveAdvancesPerSec: +(stats.draws / seconds).toFixed(1),
    uploadsPerSec: +(stats.uploads / seconds).toFixed(1),
    uploadMsPerFrame: +(stats.uploadMs / Math.max(1, frames.length)).toFixed(3),
    riveDrawMsPerFrame: +(riveMs / Math.max(1, frames.length)).toFixed(2),
    visible: document.visibilityState,
    maxFPS: canvas.app.ticker.maxFPS
  };
}
