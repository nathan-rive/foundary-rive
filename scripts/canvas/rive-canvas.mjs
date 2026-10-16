import { MODULE_ID } from "../constants.mjs";
import { RivePlayer } from "../rive-player.mjs";
import { applyInitialState, bindProperties } from "../state.mjs";
import * as sync from "../sync.mjs";
import { notifyRefusedScripts } from "../notices.mjs";

/**
 * Rive on scene Tiles and Tokens.
 *
 * A tile or token whose `flags.foundry-rive.src` is set gets a Rive player drawing
 * into its own canvas, which becomes the placeable mesh's PIXI texture. The
 * normal image stays underneath as the fallback (clients without the module,
 * frames before load), and the shared ticker re-uploads each texture after Rive
 * draws.
 *
 * Findings from the Phase 5 spike that shape this:
 * - The runtime only draws into canvases laid out in the page, so source canvases
 *   live in a hidden host element at full size, opacity 0.
 * - It exposes no "pixels changed" signal (Draw never fires; Advance fires every
 *   frame while playing), so a playing placeable uploads every frame. Cost is held
 *   down by suspending ones that are off-screen or hidden, and by an optional fps cap.
 * - A v12 tile without an image gets no mesh, so a Rive tile with no image is given
 *   a transparent one (see FALLBACK_IMAGE). Tokens always get a mesh.
 * - Tokens with a dynamic token ring draw their subject through the ring shader;
 *   v1 leaves those tokens alone (see hasDynamicRing).
 */

/** Shipped 1 px transparent image for Rive tiles that have no image of their own. */
export const FALLBACK_IMAGE = `modules/${MODULE_ID}/assets/transparent.png`;

/** Longest side of a source canvas, in pixels. Bounds per-placeable cost at high zoom. */
const MAX_TEXTURE_SIDE = 2048;

/** Shortest side a source canvas shrinks to when zoomed far out. */
const MIN_TEXTURE_SIDE = 32;

/** Wait for zooming to settle before re-rendering sources at the new resolution. */
const RESIZE_DEBOUNCE_MS = 200;

/** How often to re-check which placeables are on screen. */
const VISIBILITY_INTERVAL_MS = 250;

/** The placeable types that can carry Rive, and the document changes that need a reload. */
const KINDS = {
  Tile: { reloadKeys: ["width", "height"] },
  Token: { reloadKeys: ["width", "height", "ring"] }
};

/** Placeable -> bridge. Keyed by object, not id: a drag preview shares its original's id. */
const bridges = new Map();

/** Upload counter, for checking that suspended placeables stop uploading. */
export const stats = { uploads: 0 };

/** The Rive settings stored on a tile or token document, or null if it has none. */
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

/** Stored defaults and bindings on a tile or token document, in the same shape as Rive pages. */
export function riveState(doc) {
  const flags = doc?.flags?.[MODULE_ID] ?? {};
  const list = value => (Array.isArray(value) ? value : []);
  return { inputs: list(flags.inputs), properties: list(flags.properties), bindings: list(flags.bindings) };
}

/** v1 doesn't draw Rive on tokens with a dynamic token ring. */
export function hasDynamicRing(doc) {
  return (doc?.documentName === "Token" || doc?.constructor?.name === "PrototypeToken") && Boolean(doc.ring?.enabled);
}

/** The player drawing a placeable, if it has loaded. */
export function playerFor(placeable) {
  return bridges.get(placeable)?.player ?? null;
}

/** What `@actor` in a binding means for this placeable: a token's own actor (linked or not). */
export function bindingContext(placeable) {
  if (placeable?.document?.documentName !== "Token") return {};
  // Getters: Foundry can replace a token's synthetic actor object, so resolve each time.
  return {
    get actor() {
      return placeable.document.actor ?? null;
    },
    get token() {
      return placeable.document;
    }
  };
}

export function registerCanvas() {
  for (const [kind, { reloadKeys }] of Object.entries(KINDS)) {
    // Drag previews draw a clone of their original's texture, which shares our
    // source, so they animate without a player of their own.
    Hooks.on(`draw${kind}`, placeable => {
      if (!placeable.isPreview) attach(placeable);
    });
    Hooks.on(`destroy${kind}`, placeable => detach(placeable));
    Hooks.on(`refresh${kind}`, placeable => {
      // Keep our texture on the mesh if a refresh restored the image.
      const bridge = bridges.get(placeable);
      if (bridge?.texture && placeable.mesh && placeable.mesh.texture !== bridge.texture) placeable.mesh.texture = bridge.texture;
    });
    Hooks.on(`update${kind}`, (doc, changes) => {
      const placeable = doc.object;
      if (!placeable || placeable.isPreview) return;
      const flagChanges = foundry.utils.getProperty(changes, `flags.${MODULE_ID}`) ?? {};
      const reload = ["src", "artboard", "stateMachine", "fit"].some(k => k in flagChanges)
        || Object.keys(flagChanges).some(k => k.startsWith("-="))
        || `-=${MODULE_ID}` in (changes.flags ?? {})
        || reloadKeys.some(k => k in changes);
      if (reload) return attach(placeable);
      // Only defaults or bindings changed: re-apply them without reloading the file.
      if (["inputs", "properties", "bindings"].some(k => k in flagChanges)) applyState(placeable);
    });
  }
  Hooks.on("preCreateTile", doc => {
    if (riveFlags(doc) && !doc.texture.src) doc.updateSource({ "texture.src": FALLBACK_IMAGE });
  });
  Hooks.on("preUpdateTile", (doc, changes) => {
    const merged = foundry.utils.mergeObject(doc.toObject(), changes, { inplace: false });
    if (riveFlags(merged) && !merged.texture?.src) foundry.utils.setProperty(changes, "texture.src", FALLBACK_IMAGE);
  });
  Hooks.on("canvasTearDown", () => [...bridges.keys()].forEach(detach));
  // Rive is vector art: when the zoom changes, re-render sources at the resolution
  // they are actually shown at, rather than stretching a fixed-size texture.
  const rescaleAll = foundry.utils.debounce(() => {
    for (const placeable of bridges.keys()) rescale(placeable);
  }, RESIZE_DEBOUNCE_MS);
  Hooks.on("canvasPan", rescaleAll);
  Hooks.on("canvasReady", () => {
    canvas.app.ticker.remove(tick);
    canvas.app.ticker.add(tick, null, PIXI.UPDATE_PRIORITY.HIGH);
  });
}

/**
 * Target pixel size of a placeable, from its stored (not animated) data: Foundry
 * animates token size changes, so the live width/height are mid-animation when
 * our update hook runs. Tokens are sized in grid units, tiles in pixels.
 */
function pixelSize(placeable) {
  const { width, height } = placeable.document._source;
  if (placeable.document.documentName === "Token") {
    return { width: width * canvas.grid.sizeX, height: height * canvas.grid.sizeY };
  }
  return { width, height };
}

/**
 * Source canvas size for a placeable at the current view: its scene size times
 * the canvas zoom and the display's pixel ratio, so it matches the screen pixels
 * it covers. The scale moves in steps of √2 so small zoom changes don't trigger a
 * re-render, and the longest side stays within MIN/MAX_TEXTURE_SIDE.
 */
function sourceSize(placeable) {
  const { width, height } = pixelSize(placeable);
  const shown = (canvas.stage?.scale?.x || 1) * (canvas.app?.renderer?.resolution || 1);
  let scale = Math.SQRT2 ** Math.ceil(Math.log(shown) / Math.log(Math.SQRT2));
  const longest = Math.max(width, height) * scale;
  if (longest > MAX_TEXTURE_SIDE) scale *= MAX_TEXTURE_SIDE / longest;
  else if (longest < MIN_TEXTURE_SIDE) scale *= MIN_TEXTURE_SIDE / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Re-renders a placeable's source at the size its current view needs, if that
 * changed. Resizing a canvas clears it, so the GPU texture keeps showing the old
 * picture (uploads are held) until Rive has drawn at the new size; then the
 * texture is resized and uploaded in one step. Swapping straight away showed an
 * empty or mismatched texture for a frame: a flicker on every zoom.
 */
async function rescale(placeable) {
  const bridge = bridges.get(placeable);
  if (!bridge?.player?.rive || !bridge.texture) return;
  const { width, height } = sourceSize(placeable);
  const { source, player } = bridge;
  if (source.width === width && source.height === height) return;

  const attempt = (bridge.rescaleAttempt ?? 0) + 1;
  bridge.rescaleAttempt = attempt;
  bridge.holdUploads = true;
  sizeSource(source, width, height);
  player.rive.resizeDrawingSurfaceToCanvas(1);
  // A paused (off-screen) player waits here until it plays and has drawn again.
  await advancesEvenIfPaused(player, 2);

  // Superseded by a later zoom, or torn down while we waited.
  if (bridge.rescaleAttempt !== attempt || bridges.get(placeable) !== bridge || !bridge.texture) return;
  const base = bridge.texture.baseTexture;
  base.resource.resize(width, height);
  base.setRealSize(width, height);
  base.update();
  bridge.holdUploads = false;
  bridge.dirty = false;
  bridge.lastUpload = performance.now();
  placeable.renderFlags.set({ refreshMesh: true });
}

/** Resolves after `n` Rive Advance events, however long the player stays paused; or when it's destroyed. */
function advancesEvenIfPaused(player, n) {
  const rive = player.rive;
  if (!rive) return Promise.resolve();
  const { Advance } = globalThis.rive.EventType;
  return new Promise(resolve => {
    let left = n;
    const done = () => {
      rive.off(Advance, onAdvance);
      resolve();
    };
    const onAdvance = () => {
      if (--left <= 0) done();
    };
    rive.on(Advance, onAdvance);
    player.onDestroy(done);
  });
}

/** Sets a source canvas's pixel size and matching CSS size (Rive reads both). */
function sizeSource(source, width, height) {
  source.width = width;
  source.height = height;
  source.style.width = `${width}px`;
  source.style.height = `${height}px`;
}

async function attach(placeable) {
  detach(placeable);
  const doc = placeable.document;
  const settings = riveFlags(doc);
  if (!settings || !placeable.mesh || hasDynamicRing(doc)) return;

  const { width, height } = sourceSize(placeable);
  const source = document.createElement("canvas");
  sizeSource(source, width, height);
  Object.assign(source.style, {
    position: "fixed", left: "0px", top: "0px",
    opacity: "0", pointerEvents: "none", zIndex: "-1"
  });
  host().append(source);

  const bridge = { player: null, texture: null, source, dirty: false, lastUpload: 0, suspended: false, stop: null };
  bridges.set(placeable, bridge);

  let player;
  try {
    player = await RivePlayer.mount(source, { ...settings, offscreen: true });
  } catch (err) {
    console.error(`${MODULE_ID} | ${doc.documentName} ${placeable.id}:`, err);
    if (bridges.get(placeable) === bridge) bridges.delete(placeable);
    source.remove();
    return;
  }
  // Redrawn, re-attached or deleted while we loaded.
  if (bridges.get(placeable) !== bridge || placeable.destroyed || !placeable.mesh) {
    source.remove();
    return player.destroy();
  }

  bridge.player = player;
  notifyRefusedScripts(player, settings.src);
  bridge.texture = PIXI.Texture.from(source);
  const markDirty = () => (bridge.dirty = true);
  player.rive.on(globalThis.rive.EventType.Advance, markDirty);
  bridge.stop = () => player.rive?.off(globalThis.rive.EventType.Advance, markDirty);

  player.onDestroy(() => bridge.unbind?.());
  sync.track(doc.uuid, player, { applyNow: false });
  applyState(placeable);

  // Keep what Foundry drew with, to hand back before our texture is destroyed.
  bridge.original = { texture: placeable.texture, meshTexture: placeable.mesh.texture };
  placeable.texture = bridge.texture;
  placeable.mesh.texture = bridge.texture;
  placeable.renderFlags.set({ refreshMesh: true });
}

/**
 * Starting values (live GM value, else bound data, else stored default), applied
 * the same way on every client (see applyInitialState); bindings then follow
 * later document changes.
 */
function applyState(placeable) {
  const bridge = bridges.get(placeable);
  if (!bridge?.player) return;
  const doc = placeable.document;
  const state = riveState(doc);
  const context = bindingContext(placeable);
  bridge.unbind?.();
  bridge.unbind = bindProperties(bridge.player, state.bindings, { applyNow: false, context });
  applyInitialState(bridge.player, { target: doc.uuid, ...state, context, liveValues: sync.knownValues });
}

function detach(placeable) {
  const bridge = bridges.get(placeable);
  if (!bridge) return;
  bridges.delete(placeable);
  releaseBridge(placeable, bridge);
}

/**
 * Takes a bridge apart without ever throwing into Foundry (this runs inside its
 * destroy and tear-down paths). Foundry gets its own texture back first; if that
 * fails, ours is left for the garbage collector rather than destroyed while a
 * tile may still hold it.
 */
export function releaseBridge(placeable, bridge) {
  const step = fn => {
    try {
      fn();
      return true;
    } catch (err) {
      console.error(`${MODULE_ID} | ${placeable?.document?.documentName ?? "Placeable"} ${placeable?.id}:`, err);
      return false;
    }
  };
  const restored = step(() => restoreTextures(placeable, bridge));
  step(() => bridge.stop?.());
  step(() => bridge.player?.destroy());
  if (restored) step(() => bridge.texture?.destroy(true));
  step(() => bridge.source?.remove());
}

/**
 * Points the placeable and its mesh back at Foundry's own texture, so nothing
 * holds ours once it's destroyed. Foundry reads a tile's texture while tearing
 * the canvas down (TilesLayer#_tearDown checks `isVideo`), which runs after our
 * canvasTearDown hook: a destroyed texture there throws, aborts the layer's
 * tear-down and leaves the Tiles layer unclickable until a reload.
 */
export function restoreTextures(placeable, bridge) {
  if (!bridge?.texture) return;
  const usable = texture => Boolean(texture) && texture !== bridge.texture && !texture.destroyed
    && Boolean(texture.baseTexture) && !texture.baseTexture.destroyed;
  if (placeable.texture === bridge.texture) {
    placeable.texture = usable(bridge.original?.texture) ? bridge.original.texture : null;
  }
  const mesh = placeable.mesh;
  if (mesh && !mesh.destroyed && mesh.texture === bridge.texture) {
    mesh.texture = usable(bridge.original?.meshTexture) ? bridge.original.meshTexture : PIXI.Texture.EMPTY;
  }
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

/**
 * Runs on Foundry's canvas ticker, so it must never throw: PIXI doesn't schedule
 * the next frame after a listener throws, which would freeze the whole canvas.
 * A bridge that fails here is logged once and left alone.
 */
export function tick() {
  const now = performance.now();
  if (now - lastVisibilityCheck >= VISIBILITY_INTERVAL_MS) {
    lastVisibilityCheck = now;
    updateVisibility();
  }
  const minInterval = tileFps > 0 ? 1000 / tileFps - 1 : 0;
  for (const bridge of bridges.values()) {
    if (bridge.failed || !bridge.dirty || !bridge.texture || bridge.suspended || bridge.holdUploads) continue;
    if (now - bridge.lastUpload < minInterval) continue;
    bridge.dirty = false;
    bridge.lastUpload = now;
    guardBridge(bridge, () => bridge.texture.baseTexture.update());
    stats.uploads++;
  }
}

/** Suspends players whose placeable is hidden from this user or entirely off screen. */
function updateVisibility() {
  const screen = canvas.app.renderer.screen;
  for (const [placeable, bridge] of bridges) {
    if (bridge.failed || !bridge.player || !placeable.mesh) continue;
    guardBridge(bridge, () => {
      let visible = placeable.visible && placeable.mesh.visible && placeable.mesh.worldAlpha > 0;
      if (visible) {
        const b = placeable.mesh.getBounds();
        visible = b.right > screen.left && b.left < screen.right && b.bottom > screen.top && b.top < screen.bottom;
      }
      if (visible === !bridge.suspended) return;
      bridge.suspended = !visible;
      bridge.player.suspend(bridge.suspended);
    });
  }
}

/** Runs one bridge's per-frame work; an error stops that bridge, never the ticker. */
function guardBridge(bridge, fn) {
  try {
    fn();
  } catch (err) {
    bridge.failed = true;
    console.error(`${MODULE_ID} | a Rive tile or token stopped updating:`, err);
  }
}

/** For tests: the live bridges map. */
export function _bridgesForTests() {
  return bridges;
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

/** Live bridges, for diagnostics: [{kind, id, suspended, playing}]. */
export function describeBridges() {
  return [...bridges].map(([p, b]) => ({
    kind: p.document.documentName,
    id: p.id,
    tileId: p.id,
    suspended: b.suspended,
    playing: b.player?.rive?.isPlaying ?? false
  }));
}
