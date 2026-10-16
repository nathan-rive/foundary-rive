import { MODULE_ID } from "../constants.mjs";
import { RivePlayer } from "../rive-player.mjs";
import { uploadRiv } from "../riv-wrapper.mjs";
import { FITS } from "../journal/rive-page-model.mjs";

/**
 * Adds a "Rive" tab to the v12 (AppV1) Tile config sheet. Its inputs are named
 * `flags.foundry-rive.*`, so the sheet's own submit saves them; nothing here
 * writes to the document except an upload.
 */
export function registerTileConfig() {
  Hooks.on("renderTileConfig", (app, html) => injectTab(app, html[0] ?? html));
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
    <p class="rive-status hint"></p>`;
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

  // Suggest the file's artboards and state machines once we know the file.
  const suggest = () => fillSuggestions(srcInput.value, tab, app.id, status);
  srcInput.addEventListener("change", suggest);
  if (srcInput.value) suggest();

  // AppV1 tabs bind by delegation, so the new tab works; restore it if it was open.
  if (app._tabs?.[0]?.active === "rive") app._tabs[0].activate("rive");
  app.setPosition({ height: "auto" });
}

/** Loads the file briefly in a hidden player to list its artboards and state machines. */
async function fillSuggestions(src, tab, appId, status) {
  const artboards = tab.querySelector(`#${CSS.escape(`${appId}-rive-artboards`)}`);
  const sms = tab.querySelector(`#${CSS.escape(`${appId}-rive-sms`)}`);
  artboards.replaceChildren();
  sms.replaceChildren();
  if (!src) return;
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  try {
    const player = await RivePlayer.mount(probe, { src, autoplay: false, offscreen: true });
    const boards = player.contents?.artboards ?? [];
    player.destroy();
    artboards.append(...boards.map(a => new Option(a.name, a.name)));
    const names = [...new Set(boards.flatMap(a => a.stateMachines.map(s => s.name)))];
    sms.append(...names.map(n => new Option(n, n)));
    status.textContent = "";
  } catch (err) {
    status.textContent = game.i18n.format("FOUNDRY_RIVE.LoadFailed", { error: err.message });
  }
}
