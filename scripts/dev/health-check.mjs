import { MODULE_ID } from "../constants.mjs";
import { hasDynamicRing, playerFor, riveFlags } from "../canvas/rive-canvas.mjs";

/**
 * In-world health check for test builds and releases (see "Health check" in
 * CLAUDE.md). Run as GM in a scene with Rive tiles and tokens:
 *
 *   await game.modules.get("foundry-rive").api.healthCheck()
 *
 * It writes nothing to the world: it redraws this client's canvas, selects and
 * releases objects locally (restoring what was selected), and opens and closes
 * config sheets. The failures it looks for are the ones that make a world
 * unusable without touching its data, like a layer left unclickable after a
 * redraw.
 */

/** Messages the Rive runtime logs for files without a view model; not our errors. */
const KNOWN_NOISE = [/Could not find a View Model linked to Artboard/];

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function healthCheck({ redraws = 2, sheets = true, settleMs = 10000 } = {}) {
  if (!game.user.isGM) throw new Error("The Rive health check is for GMs.");
  if (!canvas.ready) throw new Error("Open a scene first.");
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail: String(detail ?? "") });
  const errors = captureErrors();
  const before = { layer: canvas.activeLayer, tokens: [...canvas.tokens.controlled], tiles: [...canvas.tiles.controlled] };

  try {
    for (let i = 0; i < redraws; i++) {
      await canvas.draw();
      await settle(settleMs);
    }
    check(`canvas redrawn ${redraws}×`, canvas.ready);
    checkLayers(check);
    checkTiles(check);
    const rive = riveObjects();
    check("scene has a Rive tile and token to check", rive.tile && rive.token,
      `${rive.tiles.length} Rive tiles, ${rive.tokens.length} Rive tokens`);
    checkPlayers(check, rive);
    for (const placeable of [rive.tile, rive.token].filter(Boolean)) checkPointer(check, placeable);
    if (sheets) for (const placeable of [rive.tile, rive.token].filter(Boolean)) await checkSheet(check, placeable);
  } catch (err) {
    check("health check ran to the end", false, err?.stack ?? err);
  } finally {
    restoreSelection(before);
    errors.stop();
  }
  check("no errors logged", errors.list.length === 0, errors.list.slice(0, 5).join("\n"));

  const ok = results.every(r => r.ok);
  const report = { ok, version: game.modules.get(MODULE_ID)?.version, scene: canvas.scene?.name, results };
  console.log(`${MODULE_ID} | health check ${ok ? "passed" : "FAILED"}`);
  console.table(results);
  return report;
}

/** Waits until every Rive tile and token has its player back, or the timeout. */
async function settle(timeoutMs) {
  const start = Date.now();
  await wait(500);
  while (Date.now() - start < timeoutMs) {
    const { tiles, tokens } = riveObjects();
    if ([...tiles, ...tokens].every(p => playerFor(p)?.rive)) break;
    await wait(250);
  }
  await wait(500);
}

function riveObjects() {
  const tiles = canvas.tiles.placeables.filter(t => riveFlags(t.document));
  const tokens = canvas.tokens.placeables.filter(t => riveFlags(t.document) && !hasDynamicRing(t.document));
  return { tiles, tokens, tile: tiles[0] ?? null, token: tokens[0] ?? null };
}

/** A layer left non-renderable ignores the pointer: everything on it becomes unclickable. */
function checkLayers(check) {
  const stuck = Object.keys(CONFIG.Canvas.layers)
    // The grid layer is only renderable on gridded scenes with visible lines; Foundry decides that itself.
    .filter(name => name !== "grid" && canvas[name] && !canvas[name].renderable);
  check("every canvas layer is interactive", stuck.length === 0, stuck.join(", "));
}

/** Foundry reads every tile's texture through these getters (in tear-down, among others). */
function checkTiles(check) {
  const broken = [];
  for (const tile of canvas.tiles.placeables) {
    try {
      void tile.isVideo;
      void tile.sourceElement;
    } catch (err) {
      broken.push(`${tile.id}: ${err.message}`);
    }
  }
  check("Foundry's tile getters work on every tile", broken.length === 0, broken.join("; "));
}

function checkPlayers(check, { tiles, tokens }) {
  const missing = [];
  const deadTextures = [];
  for (const placeable of [...tiles, ...tokens]) {
    const label = `${placeable.document.documentName} ${placeable.id}`;
    if (!playerFor(placeable)?.rive) missing.push(label);
    for (const [where, texture] of [["texture", placeable.texture], ["mesh texture", placeable.mesh?.texture]]) {
      if (texture && !textureAlive(texture)) deadTextures.push(`${label} ${where}`);
    }
  }
  check("every Rive tile and token has a player", missing.length === 0, missing.join(", "));
  check("no placeable holds a destroyed texture", deadTextures.length === 0, deadTextures.join(", "));
}

function textureAlive(texture) {
  if (texture === PIXI.Texture.EMPTY) return true;
  return !texture.destroyed && Boolean(texture.baseTexture) && !texture.baseTexture.destroyed && Boolean(texture.baseTexture.resource);
}

/** The pointer finds the object (a hit test at its centre) and it can be selected. */
function checkPointer(check, placeable) {
  const kind = placeable.document.documentName;
  const layer = kind === "Tile" ? canvas.tiles : canvas.tokens;
  layer.activate();
  const point = canvas.stage.worldTransform.apply(placeable.center);
  let target = canvas.app.renderer.events.rootBoundary.hitTest(point.x, point.y);
  while (target && !(target instanceof PlaceableObject)) target = target.parent;
  const found = target?.document?.documentName === kind;
  check(`pointer finds a ${kind} at a Rive ${kind.toLowerCase()}'s centre`, found,
    found ? (target === placeable ? "" : `found ${target.id}, stacked above ${placeable.id}`) : `hit ${target?.constructor?.name ?? "nothing"}`);
  placeable.control({ releaseOthers: true });
  check(`a Rive ${kind.toLowerCase()} can be selected`, layer.controlled.includes(placeable));
  placeable.release();
}

/** Its config sheet opens with the Rive tab at top level, and the tab shows. */
async function checkSheet(check, placeable) {
  const kind = placeable.document.documentName;
  const app = placeable.document.sheet;
  try {
    await app._render(true);
    const root = app.element?.[0];
    const tab = root?.querySelector('.tab[data-tab="rive"]');
    const topLevel = Boolean(tab) && !tab.parentElement.closest(".tab");
    root?.querySelector('nav [data-tab="rive"]')?.click();
    await wait(300);
    const shows = Boolean(tab) && tab.classList.contains("active") && tab.offsetHeight > 0;
    check(`${kind} config has a top-level Rive tab that shows`, topLevel && shows,
      !tab ? "no Rive tab" : !topLevel ? `nested in ${tab.parentElement.closest(".tab").dataset.tab}` : !shows ? "doesn't show when clicked" : "");
  } finally {
    await app.close();
  }
}

function restoreSelection({ layer, tokens, tiles }) {
  try {
    canvas.tokens.releaseAll();
    canvas.tiles.releaseAll();
    for (const t of tokens) if (!t.destroyed) t.control({ releaseOthers: false });
    for (const t of tiles) if (!t.destroyed) t.control({ releaseOthers: false });
    layer?.activate?.();
  } catch (err) {
    console.warn(`${MODULE_ID} | couldn't restore the selection after the health check`, err);
  }
}

/** Collects console errors and uncaught errors while the check runs. */
function captureErrors() {
  const list = [];
  const keep = text => {
    if (!KNOWN_NOISE.some(rx => rx.test(text))) list.push(text.slice(0, 500));
  };
  const original = console.error;
  console.error = (...args) => {
    keep(args.map(a => a?.stack ?? a?.message ?? String(a)).join(" "));
    original.apply(console, args);
  };
  const onError = event => keep(String(event?.error?.stack ?? event?.message ?? event));
  const onRejection = event => keep(String(event?.reason?.stack ?? event?.reason ?? event));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return {
    list,
    stop() {
      console.error = original;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    }
  };
}
