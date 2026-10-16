import { MODULE_ID, SAMPLE_RIV, WASM_PATH } from "./constants.mjs";
import { RivePlayer } from "./rive-player.mjs";
import * as spikes from "./spikes.mjs";
import * as wrapper from "./riv-wrapper.mjs";
import { RivePageModel } from "./journal/rive-page-model.mjs";
import { RivePageSheet } from "./journal/rive-page-sheet.mjs";
import { activateEmbeds, registerEnricher } from "./enricher.mjs";
import * as sync from "./sync.mjs";
import * as tiles from "./canvas/rive-tiles.mjs";
import { registerTileConfig } from "./canvas/tile-config.mjs";
import { registerTileHud } from "./canvas/tile-hud.mjs";

/** The JournalEntryPage sub-type declared in module.json, prefixed with the module id. */
export const PAGE_TYPE = `${MODULE_ID}.rive`;

Hooks.once("init", () => {
  // Self-host the WASM instead of letting the runtime fetch it from unpkg.
  globalThis.rive.RuntimeLoader.setWasmUrl(foundry.utils.getRoute(WASM_PATH));

  CONFIG.JournalEntryPage.dataModels[PAGE_TYPE] = RivePageModel;
  CONFIG.JournalEntryPage.typeLabels[PAGE_TYPE] = "FOUNDRY_RIVE.PageType";
  CONFIG.JournalEntryPage.typeIcons ??= {};
  CONFIG.JournalEntryPage.typeIcons[PAGE_TYPE] = "fa-solid fa-shapes";
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, RivePageSheet, {
    types: [PAGE_TYPE],
    makeDefault: true,
    label: "FOUNDRY_RIVE.PageType"
  });
  registerEnricher();
  sync.registerSocket();
  registerSettings();
  tiles.registerTiles();
  registerTileConfig();
  registerTileHud();

  game.modules.get(MODULE_ID).api = { RivePlayer, spikes, wrapper, openTestDialog, PAGE_TYPE, tiles };
});

Hooks.once("ready", () => {
  globalThis.rive.RuntimeLoader.awaitInstance().catch(err => console.error(`${MODULE_ID} | WASM failed to load`, err));

  // Inline embeds mount when they enter the page; the debounced sweep frees
  // players whose canvas left the page without a teardown.
  const sweep = foundry.utils.debounce(() => RivePlayer.sweep(), 1000);
  let pending = false;
  new MutationObserver(() => {
    sweep();
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      activateEmbeds();
    });
  }).observe(document.body, { childList: true, subtree: true });
  activateEmbeds();
});

/** Per-client performance settings. */
function registerSettings() {
  game.settings.register(MODULE_ID, "tileFps", {
    name: "FOUNDRY_RIVE.Settings.TileFps.Name",
    hint: "FOUNDRY_RIVE.Settings.TileFps.Hint",
    scope: "client",
    config: true,
    type: Number,
    choices: {
      0: "FOUNDRY_RIVE.Settings.TileFps.Full",
      30: "FOUNDRY_RIVE.Settings.TileFps.30",
      15: "FOUNDRY_RIVE.Settings.TileFps.15"
    },
    default: 0,
    onChange: value => tiles.setTileFps(value)
  });
  tiles.setTileFps(game.settings.get(MODULE_ID, "tileFps"));
  game.settings.register(MODULE_ID, "maxPlayers", {
    name: "FOUNDRY_RIVE.Settings.MaxPlayers.Name",
    hint: "FOUNDRY_RIVE.Settings.MaxPlayers.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 8, max: 128, step: 8 },
    default: RivePlayer.maxLive,
    onChange: value => (RivePlayer.maxLive = value)
  });
  RivePlayer.maxLive = game.settings.get(MODULE_ID, "maxPlayers");
}

/** Phase 0 gate: a hard-coded .riv playing in a plain dialog. */
export function openTestDialog({ src = SAMPLE_RIV, stateMachine } = {}) {
  let player = null;
  return new Dialog(
    {
      title: "Rive test",
      content: `<canvas class="rive-test" style="width:100%;height:360px;display:block"></canvas>`,
      buttons: {},
      render: async html => {
        const canvas = html[0].querySelector("canvas.rive-test") ?? html.find("canvas.rive-test")[0];
        try {
          player = await RivePlayer.mount(canvas, { src, stateMachine });
        } catch (err) {
          ui.notifications.error(err.message);
        }
      },
      close: () => player?.destroy()
    },
    { width: 520 }
  ).render(true);
}
