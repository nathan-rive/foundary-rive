import { MODULE_ID } from "../constants.mjs";
import { RivePlayer } from "../rive-player.mjs";
import { applyInputs, applyProperties, bindProperties } from "../state.mjs";
import * as sync from "../sync.mjs";

/**
 * Rive on scene Tiles.
 *
 * A tile whose `flags.foundry-rive.src` is set gets a Rive player drawing into
 * its own canvas, which becomes the tile mesh's PIXI texture. The tile's normal
 * image stays underneath as the fallback (clients without the module, frames
 * before load), and the shared ticker re-uploads each texture after Rive draws.
 *
 * Findings from the Phase 5 spike that shape this:
 * - The runtime only draws into canvases laid out in the page, so source canvases
 *   live in a hidden host element at full size, opacity 0.
 * - It exposes no "pixels changed" signal (Draw never fires; Advance fires every
 *   frame while playing), so a playing tile uploads every frame. Cost is held down
 *   by suspending tiles that are off-screen or hidden, and by an optional fps cap.
 * - A v12 tile without an image gets no mesh, so a Rive tile with no image is given
 *   a transparent one (see FALLBACK_IMAGE).
 */

/** Shipped 1 px transparent image for Rive tiles that have no image of their own. */
export const FALLBACK_IMAGE = `modules/${MODULE_ID}/assets/transparent.png`;

/** Longest side of a source canvas, in pixels. Bounds per-tile cost. */
const MAX_TEXTURE_SIDE = 512;

/** How often to re-check which tiles are on screen. */
const VISIBILITY_INTERVAL_MS = 250;

/** Tile -> bridge. Keyed by object, not id: a drag preview shares its original's id. */
const bridges = new Map();

/** Upload counter, for checking that suspended tiles stop uploading. */
export const stats = { uploads: 0 };

/** The Rive settings stored on a tile document, or null if it isn't a Rive tile. */
export function riveFlags(doc) {
  const flags = doc?.flags?.[MODULE_ID];
  if (!flags?.src) return null;
  return {
    src: flags.src,
    artboard: flags.artboard || undefined,
    stateMachine: flags.stateMachine || undefined,
    fit: flags.fit || "contain"
  };
}

/** Stored defaults and bindings on a tile document, in the same shape as Rive pages. */
export function riveState(doc) {
  const flags = doc?.flags?.[MODULE_ID] ?? {};
  const list = value => (Array.isArray(value) ? value : []);
  return { inputs: list(flags.inputs), properties: list(flags.properties), bindings: list(flags.bindings) };
}

/** The player drawing a tile, if it has loaded. */
export function playerFor(tile) {
  return bridges.get(tile)?.player ?? null;
}

export function registerTiles() {
  // Drag previews draw a clone of their original's texture, which shares our
  // source, so they animate without a player of their own.
  Hooks.on("drawTile", tile => {
    if (!tile.isPreview) attach(tile);
  });
  Hooks.on("destroyTile", tile => detach(tile));
  Hooks.on("refreshTile", tile => {
    // Keep our texture on the mesh if a refresh restored the image.
    const bridge = bridges.get(tile);
    if (bridge?.texture && tile.mesh && tile.mesh.texture !== bridge.texture) tile.mesh.texture = bridge.texture;
  });
  Hooks.on("updateTile", (doc, changes) => {
    const tile = doc.object;
    if (!tile || tile.isPreview) return;
    const flagChanges = foundry.utils.getProperty(changes, `flags.${MODULE_ID}`) ?? {};
    const reload = ["src", "artboard", "stateMachine", "fit"].some(k => k in flagChanges)
      || Object.keys(flagChanges).some(k => k.startsWith("-="))
      || `-=${MODULE_ID}` in (changes.flags ?? {})
      || "width" in changes || "height" in changes;
    if (reload) return attach(tile);
    // Only defaults or bindings changed: re-apply them without reloading the file.
    if (["inputs", "properties", "bindings"].some(k => k in flagChanges)) applyState(tile);
  });
  Hooks.on("preCreateTile", doc => {
    if (riveFlags(doc) && !doc.texture.src) doc.updateSource({ "texture.src": FALLBACK_IMAGE });
  });
  Hooks.on("preUpdateTile", (doc, changes) => {
    const merged = foundry.utils.mergeObject(doc.toObject(), changes, { inplace: false });
    if (riveFlags(merged) && !merged.texture?.src) foundry.utils.setProperty(changes, "texture.src", FALLBACK_IMAGE);
  });
  Hooks.on("canvasTearDown", () => [...bridges.keys()].forEach(detach));
  Hooks.on("canvasReady", () => {
    canvas.app.ticker.remove(tick);
    canvas.app.ticker.add(tick, null, PIXI.UPDATE_PRIORITY.HIGH);
  });
}

async function attach(tile) {
  detach(tile);
  const settings = riveFlags(tile.document);
  if (!settings || !tile.mesh) return;

  const { width, height } = tile.document;
  const scale = Math.min(1, MAX_TEXTURE_SIDE / Math.max(width, height));
  const source = document.createElement("canvas");
  source.width = Math.max(1, Math.round(width * scale));
  source.height = Math.max(1, Math.round(height * scale));
  Object.assign(source.style, {
    position: "fixed", left: "0px", top: "0px",
    width: `${source.width}px`, height: `${source.height}px`,
    opacity: "0", pointerEvents: "none", zIndex: "-1"
  });
  host().append(source);

  const bridge = { player: null, texture: null, source, dirty: false, lastUpload: 0, suspended: false, stop: null };
  bridges.set(tile, bridge);

  let player;
  try {
    player = await RivePlayer.mount(source, { ...settings, offscreen: true });
  } catch (err) {
    console.error(`${MODULE_ID} | tile ${tile.id}:`, err);
    if (bridges.get(tile) === bridge) bridges.delete(tile);
    source.remove();
    return;
  }
  // Redrawn, re-attached or deleted while we loaded.
  if (bridges.get(tile) !== bridge || tile.destroyed || !tile.mesh) {
    source.remove();
    return player.destroy();
  }

  bridge.player = player;
  bridge.texture = PIXI.Texture.from(source);
  const markDirty = () => (bridge.dirty = true);
  player.rive.on(globalThis.rive.EventType.Advance, markDirty);
  bridge.stop = () => player.rive?.off(globalThis.rive.EventType.Advance, markDirty);

  player.onDestroy(() => bridge.unbind?.());
  applyState(tile);
  sync.track(tile.document.uuid, player);

  tile.texture = bridge.texture;
  tile.mesh.texture = bridge.texture;
  tile.renderFlags.set({ refreshMesh: true });
}

/** Stored defaults, then bindings to document data, then live GM values on top. */
function applyState(tile) {
  const bridge = bridges.get(tile);
  if (!bridge?.player) return;
  const state = riveState(tile.document);
  applyInputs(bridge.player, state.inputs);
  applyProperties(bridge.player, state.properties);
  bridge.unbind?.();
  bridge.unbind = bindProperties(bridge.player, state.bindings);
  sync.applyKnown(tile.document.uuid, bridge.player);
}

function detach(tile) {
  const bridge = bridges.get(tile);
  if (!bridge) return;
  bridges.delete(tile);
  bridge.stop?.();
  bridge.player?.destroy();
  bridge.texture?.destroy(true);
  bridge.source.remove();
}

/* -------------------------------------------- */
/*  Per-frame work                              */
/* -------------------------------------------- */

let lastVisibilityCheck = 0;

/** Upload rate cap from the "tileFps" client setting; 0 = every frame. */
let tileFps = 0;
export function setTileFps(fps) {
  tileFps = Number(fps) || 0;
}

function tick() {
  const now = performance.now();
  if (now - lastVisibilityCheck >= VISIBILITY_INTERVAL_MS) {
    lastVisibilityCheck = now;
    updateVisibility();
  }
  const minInterval = tileFps > 0 ? 1000 / tileFps - 1 : 0;
  for (const bridge of bridges.values()) {
    if (!bridge.dirty || !bridge.texture || bridge.suspended) continue;
    if (now - bridge.lastUpload < minInterval) continue;
    bridge.dirty = false;
    bridge.lastUpload = now;
    bridge.texture.baseTexture.update();
    stats.uploads++;
  }
}

/** Suspends players whose tile is hidden from this user or entirely off screen. */
function updateVisibility() {
  const screen = canvas.app.renderer.screen;
  for (const [tile, bridge] of bridges) {
    if (!bridge.player || !tile.mesh) continue;
    let visible = tile.visible && tile.mesh.visible && tile.mesh.worldAlpha > 0;
    if (visible) {
      const b = tile.mesh.getBounds();
      visible = b.right > screen.left && b.left < screen.right && b.bottom > screen.top && b.top < screen.bottom;
    }
    if (visible === !bridge.suspended) continue;
    bridge.suspended = !visible;
    bridge.player.suspend(bridge.suspended);
  }
}

function host() {
  let el = document.getElementById(`${MODULE_ID}-tile-sources`);
  if (!el) {
    el = document.createElement("div");
    el.id = `${MODULE_ID}-tile-sources`;
    el.setAttribute("aria-hidden", "true");
    document.body.append(el);
  }
  return el;
}

/** Live bridges, for diagnostics: [{tileId, suspended, playing}]. */
export function describeBridges() {
  return [...bridges].map(([tile, b]) => ({ tileId: tile.id, suspended: b.suspended, playing: b.player?.rive?.isPlaying ?? false }));
}
