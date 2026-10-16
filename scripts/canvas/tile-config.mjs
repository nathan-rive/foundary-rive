import { MODULE_ID } from "../constants.mjs";
import { RivePlayer } from "../rive-player.mjs";
import { uploadRiv } from "../riv-wrapper.mjs";
import { FITS } from "../journal/rive-page-model.mjs";
import { renderDefaultsEditor } from "../live-controls.mjs";
import { riveState } from "./rive-tiles.mjs";

/**
 * Adds a "Rive" tab to the v12 (AppV1) Tile config sheet. Its file, artboard,
 * state machine and fit inputs are named `flags.foundry-rive.*`, so the sheet's
 * own submit saves them. Default values and bindings are edited against a hidden
 * preview player and saved straight to the tile's flags.
 */
export function registerTileConfig() {
  Hooks.on("renderTileConfig", (app, html) => injectTab(app, html[0] ?? html));
  Hooks.on("closeTileConfig", app => releasePreview(app.id));
}

/** Config app id -> hidden player used to list the file's contents and edit defaults. */
const previews = new Map();

function releasePreview(appId) {
  previews.get(appId)?.destroy();
  previews.delete(appId);
}

function injectTab(app, root) {
  const nav = root.querySelector("nav.sheet-tabs, nav.tabs");
  const lastTab = [...root.querySelectorAll(".tab[data-tab]")].at(-1);
  if (!nav || !lastTab || root.querySelector('.tab[data-tab="rive"]')) return;

  const flags = app.document.flags?.[MODULE_ID] ?? {};
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
  tab.innerHTML = `
    <p class="notes">${i18n("TileHint")}</p>
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
      srcInput.value = await uploadRiv(file, { dir: `rive/${game.world.id}` });
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

  // AppV1 tabs bind by delegation, so the new tab works; restore it if it was open.
  if (app._tabs?.[0]?.active === "rive") app._tabs[0].activate("rive");
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
  const flags = app.document.flags?.[MODULE_ID] ?? {};
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
  renderDefaultsEditor(body, player, riveState(app.document), changes => {
    const update = Object.fromEntries(Object.entries(changes).map(([key, list]) => [`flags.${MODULE_ID}.${key}`, list]));
    return app.document.update(update);
  });
  app.setPosition({ height: "auto" });
}
