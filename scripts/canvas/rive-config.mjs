import { MODULE_ID } from "../constants.mjs";
import { RivePlayer } from "../rive-player.mjs";
import { uploadRiv } from "../riv-wrapper.mjs";
import { FITS } from "../journal/rive-page-model.mjs";
import { renderDefaultsEditor } from "../live-controls.mjs";
import { hasDynamicRing, riveState } from "./rive-canvas.mjs";
import { findTabSlot } from "./tab-slot.mjs";

/**
 * Adds a "Rive" tab to the v12 (AppV1) Tile and Token config sheets (including a
 * prototype token's). Its file, artboard, state machine and fit inputs are named
 * `flags.foundry-rive.*`, so the sheet's own submit saves them. Default values and
 * bindings are edited against a hidden preview player and saved straight to the
 * document's flags (a prototype token's through its actor).
 */
export function registerRiveConfig() {
  for (const sheet of ["TileConfig", "TokenConfig"]) {
    Hooks.on(`render${sheet}`, (app, html) => injectTab(app, html[0] ?? html));
    Hooks.on(`close${sheet}`, app => {
      releasePreview(app.id);
      riveTabOpen.delete(app.id);
    });
  }
}

/** True for a token config editing an actor's prototype token rather than a placed token. */
function isPrototype(app) {
  return Boolean(app.isPrototype ?? app.object?.constructor?.name === "PrototypeToken");
}

/**
 * Saves `{inputs?, properties?, bindings?}` lists onto the sheet's document flags.
 * `render: false` keeps the open sheet as it is (tab, scroll, focus, unsaved fields):
 * the editor already shows the saved values, and the canvas still updates.
 */
function saveFlags(app, changes) {
  const update = Object.fromEntries(Object.entries(changes).map(([key, list]) => [`flags.${MODULE_ID}.${key}`, list]));
  if (isPrototype(app)) {
    const actor = app.object.parent ?? app.object.actor;
    return actor.update(Object.fromEntries(Object.entries(update).map(([path, value]) => [`prototypeToken.${path}`, value])), { render: false });
  }
  return app.document.update(update, { render: false });
}

/**
 * Config app id -> whether the Rive tab was the open one. Foundry's tab controller
 * re-activates its remembered tab before our render hook adds the Rive tab, falls
 * back to the first tab, and forgets "rive"; so we remember it ourselves.
 */
const riveTabOpen = new Map();

/** Config app id -> hidden player used to list the file's contents and edit defaults. */
const previews = new Map();

function releasePreview(appId) {
  previews.get(appId)?.destroy();
  previews.delete(appId);
}

function injectTab(app, root) {
  if (root.querySelector('.tab[data-tab="rive"]')) return;
  // Join the sheet's main tab bar, wherever other modules have added tabs (see tab-slot.mjs).
  const slot = findTabSlot(root, app._tabs);
  if (!slot) {
    console.warn(`${MODULE_ID} | No place for the Rive tab in ${app.constructor.name}; another module may have changed its tabs.`);
    return;
  }
  const { nav, group, after: lastTab, controller } = slot;

  const isToken = app.object?.documentName === "Token" || isPrototype(app);
  const flags = app.object.flags?.[MODULE_ID] ?? {};
  const i18n = key => game.i18n.localize(`FOUNDRY_RIVE.${key}`);
  const esc = value => foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const fitOptions = Object.entries(FITS)
    .map(([value, label]) => `<option value="${value}" ${value === (flags.fit || "contain") ? "selected" : ""}>${game.i18n.localize(label)}</option>`)
    .join("");

  const navItem = document.createElement("a");
  navItem.className = "item";
  navItem.dataset.tab = "rive";
  navItem.innerHTML = `<i class="fa-solid fa-shapes"></i> ${i18n("TileTab")}`;
  nav.append(navItem);

  const tab = document.createElement("div");
  tab.className = "tab";
  tab.dataset.tab = "rive";
  if (group) tab.dataset.group = group;
  tab.innerHTML = `
    <p class="notes">${i18n(isToken ? "TokenHint" : "TileHint")}</p>
    ${isToken && hasDynamicRing(app.object) ? `<p class="notification warning">${i18n("TokenRingWarning")}</p>` : ""}
    <div class="form-group">
      <label>${i18n("Source")}</label>
      <div class="form-fields">
        <input type="text" name="flags.${MODULE_ID}.src" value="${esc(flags.src)}" placeholder="rive/world/file.riv.json">
        <button type="button" class="rive-browse" data-tooltip="FILES.BrowseTooltip" tabindex="-1"><i class="fa-solid fa-file-import fa-fw"></i></button>
        ${game.user.can("FILES_UPLOAD") ? `<button type="button" class="rive-upload-button" data-tooltip="FOUNDRY_RIVE.Upload" tabindex="-1"><i class="fa-solid fa-upload fa-fw"></i></button><input type="file" class="rive-upload" accept=".riv" hidden>` : ""}
      </div>
      <p class="hint">${i18n("TileSourceHint")}</p>
    </div>
    <div class="form-group">
      <label>${i18n("Artboard")}</label>
      <div class="form-fields">
        <input type="text" name="flags.${MODULE_ID}.artboard" value="${esc(flags.artboard)}" list="${app.id}-rive-artboards" placeholder="${i18n("FileDefault")}">
        <datalist id="${app.id}-rive-artboards"></datalist>
      </div>
    </div>
    <div class="form-group">
      <label>${i18n("StateMachine")}</label>
      <div class="form-fields">
        <input type="text" name="flags.${MODULE_ID}.stateMachine" value="${esc(flags.stateMachine)}" list="${app.id}-rive-sms" placeholder="${i18n("FileDefault")}">
        <datalist id="${app.id}-rive-sms"></datalist>
      </div>
    </div>
    <div class="form-group">
      <label>${i18n("FitLabel")}</label>
      <div class="form-fields">
        <select name="flags.${MODULE_ID}.fit">${fitOptions}</select>
      </div>
    </div>
    <p class="rive-status hint"></p>
    <section class="rive-state"></section>`;
  lastTab.after(tab);

  const srcInput = tab.querySelector(`input[name="flags.${MODULE_ID}.src"]`);
  const status = tab.querySelector(".rive-status");

  tab.querySelector(".rive-browse").addEventListener("click", () => {
    new FilePicker({
      type: "text",
      current: srcInput.value,
      callback: path => {
        srcInput.value = path;
        srcInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }).browse(srcInput.value);
  });
  tab.querySelector(".rive-upload-button")?.addEventListener("click", () => tab.querySelector("input.rive-upload").click());
  tab.querySelector("input.rive-upload")?.addEventListener("change", async event => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    status.textContent = game.i18n.format("FOUNDRY_RIVE.Uploading", { name: file.name });
    try {
      srcInput.value = await uploadRiv(file);
      srcInput.dispatchEvent(new Event("change", { bubbles: true }));
      status.textContent = "";
    } catch (err) {
      status.textContent = game.i18n.format("FOUNDRY_RIVE.UploadFailed", { name: file.name, error: err.message });
    }
  });

  // Suggest the file's artboards and state machines once we know the file, and
  // list its inputs and properties for defaults and bindings.
  const suggest = () => loadPreview(app, srcInput.value, tab, status);
  srcInput.addEventListener("change", suggest);
  if (srcInput.value) suggest();

  // AppV1 tabs bind by delegation, so the new tab works. Track which tab is open,
  // and reopen the Rive tab after a re-render if it was the open one.
  nav.addEventListener("click", event => {
    const item = event.target.closest("[data-tab]");
    if (item) riveTabOpen.set(app.id, item.dataset.tab === "rive");
  });
  if (riveTabOpen.get(app.id)) {
    (controller ?? app._tabs?.[0])?.activate("rive");
  }
  app.setPosition({ height: "auto" });
}

/**
 * Loads the file in a hidden player (kept until the sheet closes or re-renders):
 * fills the artboard and state machine suggestions, and builds the defaults and
 * bindings editor from the inputs and properties the file offers.
 */
async function loadPreview(app, src, tab, status) {
  releasePreview(app.id);
  const artboards = tab.querySelector(`#${CSS.escape(`${app.id}-rive-artboards`)}`);
  const sms = tab.querySelector(`#${CSS.escape(`${app.id}-rive-sms`)}`);
  const stateSection = tab.querySelector(".rive-state");
  artboards.replaceChildren();
  sms.replaceChildren();
  stateSection.replaceChildren();
  if (!src) return;
  const flags = app.object.flags?.[MODULE_ID] ?? {};
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  let player;
  try {
    player = await RivePlayer.mount(canvas, {
      src,
      artboard: flags.artboard || undefined,
      stateMachine: flags.stateMachine || undefined,
      offscreen: true
    });
  } catch (err) {
    status.textContent = game.i18n.format("FOUNDRY_RIVE.LoadFailed", { error: err.message });
    return;
  }
  // The sheet closed or re-rendered while we loaded.
  if (!tab.isConnected) return player.destroy();
  previews.set(app.id, player);
  status.textContent = "";

  const boards = player.contents?.artboards ?? [];
  artboards.append(...boards.map(a => new Option(a.name, a.name)));
  const names = [...new Set(boards.flatMap(a => a.stateMachines.map(s => s.name)))];
  sms.append(...names.map(n => new Option(n, n)));

  const heading = document.createElement("h3");
  heading.className = "rive-state-heading";
  heading.textContent = game.i18n.localize("FOUNDRY_RIVE.TileDefaults");
  const body = document.createElement("div");
  stateSection.append(heading, body);
  renderDefaultsEditor(body, player, riveState(app.object), changes => saveFlags(app, changes));
  app.setPosition({ height: "auto" });
}
