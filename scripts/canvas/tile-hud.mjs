import { MODULE_ID } from "../constants.mjs";
import { mountLiveControls, withLiveValues } from "../live-controls.mjs";
import { playerFor, riveFlags, riveState } from "./rive-tiles.mjs";

/**
 * GM-only Rive button on the Tile HUD. It opens a small window with live controls
 * for that tile: changes play for every client on the scene through sync.mjs, and
 * can be saved onto the tile as its defaults.
 */
export function registerTileHud() {
  Hooks.on("renderTileHUD", (hud, html) => addButton(hud, html[0] ?? html));
}

/** Tile document UUID -> open live window, so the button focuses instead of duplicating. */
const windows = new Map();

function addButton(hud, root) {
  const tile = hud.object;
  if (!game.user.isGM || !riveFlags(tile?.document)) return;
  const column = root.querySelector(".col.right") ?? root.querySelector(".col");
  if (!column) return;
  const button = document.createElement("div");
  button.className = "control-icon";
  button.dataset.action = "rive-live";
  button.dataset.tooltip = "FOUNDRY_RIVE.LiveControls";
  button.innerHTML = `<i class="fa-solid fa-shapes"></i>`;
  button.addEventListener("click", () => openLiveWindow(tile));
  column.append(button);
}

export function openLiveWindow(tile) {
  const uuid = tile.document.uuid;
  const existing = windows.get(uuid);
  if (existing?.rendered) return existing.bringToTop();

  const player = playerFor(tile);
  if (!player) return ui.notifications.warn(game.i18n.localize("FOUNDRY_RIVE.TileNotLoaded"));

  let stop = null;
  const dialog = new Dialog(
    {
      title: game.i18n.format("FOUNDRY_RIVE.TileLiveTitle", { name: riveFlags(tile.document).src.split("/").pop() }),
      content: `
        <p class="notes">${game.i18n.localize("FOUNDRY_RIVE.LiveHint")}</p>
        <div class="rive-live-controls"></div>
        <button type="button" class="rive-live-save"><i class="fa-solid fa-floppy-disk"></i> ${game.i18n.localize("FOUNDRY_RIVE.LiveSave")}</button>`,
      buttons: {},
      render: html => {
        const root = html[0]?.closest(".app") ?? html[0];
        const container = root.querySelector(".rive-live-controls");
        const state = riveState(tile.document);
        stop = mountLiveControls(container, player, { target: uuid, inputs: state.inputs, properties: state.properties });
        root.querySelector(".rive-live-save").addEventListener("click", async () => {
          const merged = withLiveValues(uuid, riveState(tile.document));
          await tile.document.update({
            [`flags.${MODULE_ID}.inputs`]: merged.inputs,
            [`flags.${MODULE_ID}.properties`]: merged.properties
          });
          ui.notifications.info(game.i18n.localize("FOUNDRY_RIVE.LiveSaved"));
        });
        // If the tile's player goes away (tile deleted, scene changed), close.
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
