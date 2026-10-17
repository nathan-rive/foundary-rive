import { MODULE_ID } from "../constants.mjs";
import { mountLiveControls, withLiveValues } from "../live-controls.mjs";
import { playerFor, riveFlags, riveState } from "./rive-canvas.mjs";

/**
 * GM-only Rive button on the Tile and Token HUDs. Like the conditions palette,
 * it opens a panel docked beside the HUD with live controls for that placeable:
 * changes play for every client on the scene through sync.mjs, and can be saved
 * onto the document as its defaults. The panel lives inside the HUD, so it goes
 * away with it when the placeable is deselected.
 */
export function registerRiveHud() {
  for (const hud of ["TileHUD", "TokenHUD"]) {
    Hooks.on(`render${hud}`, (app, html) => addButton(app, html[0] ?? html));
  }
  for (const kind of ["Tile", "Token"]) {
    Hooks.on(`control${kind}`, (placeable, controlled) => {
      if (!controlled && open?.uuid === placeable.document?.uuid) closePalette();
    });
  }
  Hooks.on("canvasTearDown", () => closePalette());
  // The HUD rescales and moves with the canvas; keep the palette placed.
  Hooks.on("canvasPan", () => {
    if (open?.element?.isConnected) placePalette(open);
  });
}

/** The open palette, if any: {uuid, stop, element}. One at a time, like the HUD. */
let open = null;

function closePalette() {
  open?.stop?.();
  open?.element?.remove();
  open = null;
}

function addButton(hud, root) {
  const placeable = hud.object;
  const doc = placeable?.document;
  // The HUD moved to another object: the old palette went with the old HUD.
  if (open && open.uuid !== doc?.uuid) closePalette();
  if (!game.user.isGM || !riveFlags(doc)) return;
  const column = root.querySelector(".col.right") ?? root.querySelector(".col");
  if (!column) return;
  const button = document.createElement("div");
  button.className = "control-icon rive-live-toggle";
  button.dataset.action = "rive-live";
  button.dataset.tooltip = "FOUNDRY_RIVE.LiveControls";
  button.innerHTML = `<i class="fa-solid fa-shapes"></i>`;
  button.addEventListener("click", () => {
    if (open?.uuid === doc.uuid) {
      closePalette();
      button.classList.remove("active");
    } else openPalette(root, column, placeable, button);
  });
  column.append(button);
  // The HUD re-rendered (its object changed) while the palette was open: rebuild it.
  if (open?.uuid === doc.uuid) openPalette(root, column, placeable, button);
}

function openPalette(root, column, placeable, button) {
  closePalette();
  if (!game.user.isGM) return;
  const doc = placeable.document;
  const element = document.createElement("section");
  element.className = "rive-live-palette";
  const title = doc.documentName === "Token" ? doc.name : riveFlags(doc).src.split("/").pop();
  element.innerHTML = `
    <header class="rive-live-header">
      <h4><i class="fa-solid fa-shapes"></i> <span class="rive-live-title"></span></h4>
      <button type="button" class="rive-live-save" data-tooltip="FOUNDRY_RIVE.LiveSave"><i class="fa-solid fa-floppy-disk"></i></button>
    </header>
    <p class="hint rive-live-note"></p>
    <div class="rive-live-controls"></div>`;
  const titleEl = element.querySelector(".rive-live-title");
  titleEl.textContent = title;
  titleEl.title = `${game.i18n.localize("FOUNDRY_RIVE.LiveControls")}: ${title}`;
  // Keep clicks and wheel turns in the panel, not on the canvas under it.
  for (const type of ["pointerdown", "mousedown", "wheel", "dblclick"]) element.addEventListener(type, event => event.stopPropagation());
  root.append(element);
  button.classList.add("active");

  const player = playerFor(placeable);
  const controls = element.querySelector(".rive-live-controls");
  let stop = null;
  if (player) {
    const state = riveState(doc);
    stop = mountLiveControls(controls, player, {
      target: doc.uuid,
      inputs: state.inputs,
      properties: state.properties,
      bindings: state.bindings,
      liveHidden: state.liveHidden,
      note: element.querySelector(".rive-live-note")
    });
    // The player went away (file changed, scene redrawn): a re-render rebuilds us.
    player.onDestroy(() => {
      if (open?.element === element) controls.replaceChildren(notLoaded());
    });
  } else controls.replaceChildren(notLoaded());

  element.querySelector(".rive-live-save").addEventListener("click", async () => {
    if (!game.user.isGM) return;
    const merged = withLiveValues(doc.uuid, riveState(doc));
    await doc.update({
      [`flags.${MODULE_ID}.inputs`]: merged.inputs,
      [`flags.${MODULE_ID}.properties`]: merged.properties
    });
    ui.notifications.info(game.i18n.localize("FOUNDRY_RIVE.LiveSaved"));
  });
  open = { uuid: doc.uuid, stop, element, root, column };
  placePalette(open);
}

/** Gap between the HUD and the palette, in screen pixels. */
const GAP = 8;

/**
 * Puts the palette beside the HUD's right column (where Foundry puts the
 * conditions palette) at a constant screen size, whatever the canvas zoom: the
 * HUD is scaled with the canvas, so the palette undoes that scale. If it would
 * run under the sidebar it goes to the HUD's left instead, and it's kept inside
 * the window vertically.
 */
function placePalette({ element, root, column }) {
  const scale = new DOMMatrix(getComputedStyle(root).transform).a || 1;
  element.style.transformOrigin = "top left";
  element.style.transform = `scale(${1 / scale})`;
  element.style.maxHeight = `${Math.round(window.innerHeight * 0.6)}px`;
  // Positions are in the HUD's own (scaled) units; the palette's width in them is width / scale.
  const width = element.offsetWidth / scale;
  let left = column.offsetLeft + column.offsetWidth + GAP / scale;
  let top = column.offsetTop;
  Object.assign(element.style, { left: `${left}px`, top: `${top}px` });
  const rect = element.getBoundingClientRect();
  const limit = (document.getElementById("sidebar")?.getBoundingClientRect().left ?? window.innerWidth) - GAP;
  if (rect.right > limit) {
    const leftColumn = root.querySelector(".col.left") ?? root.firstElementChild;
    left = (leftColumn?.offsetLeft ?? 0) - width - GAP / scale;
  }
  // Vertically: up if it runs off the bottom, but never above the top of the window.
  let shift = Math.max(0, rect.bottom - (window.innerHeight - GAP));
  shift = Math.min(shift, Math.max(0, rect.top - GAP));
  top -= shift / scale;
  Object.assign(element.style, { left: `${left}px`, top: `${top}px` });
}

function notLoaded() {
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = game.i18n.localize("FOUNDRY_RIVE.TileNotLoaded");
  return p;
}
