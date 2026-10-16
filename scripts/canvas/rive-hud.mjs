import { MODULE_ID } from "../constants.mjs";
import { mountLiveControls, withLiveValues } from "../live-controls.mjs";
import { playerFor, riveFlags, riveState } from "./rive-canvas.mjs";

/**
 * GM-only Rive button on the Tile and Token HUDs. It opens a small window with
 * live controls for that placeable: changes play for every client on the scene
 * through sync.mjs, and can be saved onto the document as its defaults.
 */
export function registerRiveHud() {
  for (const hud of ["TileHUD", "TokenHUD"]) {
    Hooks.on(`render${hud}`, (app, html) => addButton(app, html[0] ?? html));
  }
}

/** Document UUID -> open live window, so the button focuses instead of duplicating. */
const windows = new Map();

function addButton(hud, root) {
  const placeable = hud.object;
  if (!game.user.isGM || !riveFlags(placeable?.document)) return;
  const column = root.querySelector(".col.right") ?? root.querySelector(".col");
  if (!column) return;
  const button = document.createElement("div");
  button.className = "control-icon";
  button.dataset.action = "rive-live";
  button.dataset.tooltip = "FOUNDRY_RIVE.LiveControls";
  button.innerHTML = `<i class="fa-solid fa-shapes"></i>`;
  button.addEventListener("click", () => openLiveWindow(placeable));
  column.append(button);
}

export function openLiveWindow(placeable) {
  if (!game.user.isGM) return;
  const doc = placeable.document;
  const uuid = doc.uuid;
  const existing = windows.get(uuid);
  if (existing?.rendered) return existing.bringToTop();

  const player = playerFor(placeable);
  if (!player) return ui.notifications.warn(game.i18n.localize("FOUNDRY_RIVE.TileNotLoaded"));

  const isToken = doc.documentName === "Token";
  const name = isToken ? doc.name : riveFlags(doc).src.split("/").pop();
  let stop = null;
  const dialog = new Dialog(
    {
      title: game.i18n.format("FOUNDRY_RIVE.TileLiveTitle", { name }),
      content: `
        <p class="notes">${game.i18n.localize(isToken ? "FOUNDRY_RIVE.TokenLiveHint" : "FOUNDRY_RIVE.TileLiveHint")}</p>
        <div class="rive-live-controls"></div>
        <button type="button" class="rive-live-save"><i class="fa-solid fa-floppy-disk"></i> ${game.i18n.localize("FOUNDRY_RIVE.LiveSave")}</button>`,
      buttons: {},
      render: html => {
        const root = html[0]?.closest(".app") ?? html[0];
        const container = root.querySelector(".rive-live-controls");
        const state = riveState(doc);
        stop = mountLiveControls(container, player, { target: uuid, inputs: state.inputs, properties: state.properties });
        root.querySelector(".rive-live-save").addEventListener("click", async () => {
          const merged = withLiveValues(uuid, riveState(doc));
          await doc.update({
            [`flags.${MODULE_ID}.inputs`]: merged.inputs,
            [`flags.${MODULE_ID}.properties`]: merged.properties
          });
          ui.notifications.info(game.i18n.localize("FOUNDRY_RIVE.LiveSaved"));
        });
        // If the placeable's player goes away (deleted, scene changed), close.
        player.onDestroy(() => dialog.close());
      },
      close: () => {
        stop?.();
        windows.delete(uuid);
      }
    },
    { width: 380, classes: ["dialog", "rive-live-window"], resizable: true }
  );
  windows.set(uuid, dialog);
  dialog.render(true);
}
