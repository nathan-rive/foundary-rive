import { MODULE_ID } from "../constants.mjs";
import { RivePlayer } from "../rive-player.mjs";
import { uploadRiv } from "../riv-wrapper.mjs";
import { ALIGNMENTS, FITS } from "./rive-page-model.mjs";
import { fitStage, initialRatio } from "../stage.mjs";
import { applyInputs, applyProperties, bindProperties } from "../state.mjs";
import * as sync from "../sync.mjs";
import { mountLiveControls, renderDefaultsEditor, withLiveValues } from "../live-controls.mjs";

/**
 * v12 (AppV1) sheet for "foundry-rive.rive" pages. The journal sheet renders it
 * twice over: in view mode (editable: false) inside the journal, and as its own
 * window in edit mode. Both mount a player in activateListeners.
 */
export class RivePageSheet extends JournalPageSheet {
  #player = null;

  static get defaultOptions() {
    const options = super.defaultOptions;
    options.classes.push("rive-page");
    options.height = "auto";
    options.submitOnChange = true;
    return options;
  }

  get template() {
    return `modules/${MODULE_ID}/templates/rive-page-${this.isEditable ? "edit" : "view"}.hbs`;
  }

  getData(options = {}) {
    const data = super.getData(options);
    data.system = this.document.system;
    data.stageRatio = initialRatio(this.document.system.aspectRatio);
    data.fits = FITS;
    data.alignments = ALIGNMENTS;
    data.canUpload = game.user.can("FILES_UPLOAD");
    data.isGM = game.user.isGM;
    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);
    this.#destroyPlayer();
    const canvas = html.find("canvas.rive-canvas")[0];
    if (canvas) this.#mount(canvas, html);
    if (this.isEditable) {
      html.find(".rive-upload-button").on("click", () => html.find("input.rive-upload")[0]?.click());
      html.find("input.rive-upload").on("change", event => this.#onUpload(event));
    }
  }

  async #mount(canvas, html) {
    const status = html.find(".rive-status")[0];
    const { src } = this.document.system;
    if (!src) {
      if (status) status.textContent = game.i18n.localize("FOUNDRY_RIVE.NoSource");
      return;
    }
    try {
      const player = await RivePlayer.mount(canvas, this.document.system.playerOptions);
      // A re-render may have started while we were loading.
      if (!canvas.isConnected) return player.destroy();
      this.#player = player;
      const system = this.document.system;
      fitStage(canvas.closest(".rive-stage"), player, system.aspectRatio);
      applyInputs(player, system.inputs);
      applyProperties(player, system.properties);
      player.onDestroy(bindProperties(player, system.bindings));
      sync.track(this.document.uuid, player);
      if (this.isEditable) {
        this.#fillChoices(html, player.contents);
        const container = html.find(".rive-state")[0];
        if (container) this.#renderDefaultsEditor(container, player);
      } else if (game.user.isGM) {
        const container = html.find(".rive-live-controls")[0];
        if (container) this.#renderLivePanel(container, html, player);
      }
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      if (status) status.textContent = game.i18n.format("FOUNDRY_RIVE.LoadFailed", { error: err.message });
    }
  }

  /** Edit sheet: values chosen here are saved on the page as its defaults. */
  #renderDefaultsEditor(container, player) {
    renderDefaultsEditor(container, player, this.document.system, changes => {
      const update = Object.fromEntries(Object.entries(changes).map(([key, list]) => [`system.${key}`, list]));
      return this.document.update(update);
    });
  }

  /** Journal view, GM only: drive the animation live for every client viewing this page. */
  #renderLivePanel(container, html, player) {
    const { inputs, properties } = this.document.system;
    mountLiveControls(container, player, { target: this.document.uuid, inputs, properties });
    html.find(".rive-live-save").on("click", () => this.#saveLiveAsDefaults());
  }

  /** Writes the current live values onto the page, so they apply on every load. */
  async #saveLiveAsDefaults() {
    const { inputs, properties } = withLiveValues(this.document.uuid, this.document.system);
    await this.document.update({ "system.inputs": inputs, "system.properties": properties });
    ui.notifications.info(game.i18n.localize("FOUNDRY_RIVE.LiveSaved"));
  }

  /** Artboard and state machine dropdowns list what the loaded file contains. */
  #fillChoices(html, contents) {
    const { artboard, stateMachine } = this.document.system;
    const boards = contents?.artboards ?? [];
    const fill = (select, names, current) => {
      if (!select) return;
      select.replaceChildren(
        new Option(game.i18n.localize("FOUNDRY_RIVE.FileDefault"), ""),
        ...names.map(n => new Option(n, n, false, n === current))
      );
    };
    fill(html.find("select[name='system.artboard']")[0], boards.map(a => a.name), artboard);
    const board = boards.find(a => a.name === artboard) ?? boards[0];
    fill(html.find("select[name='system.stateMachine']")[0], board?.stateMachines.map(s => s.name) ?? [], stateMachine);
  }

  async #onUpload(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const notice = ui.notifications.info(game.i18n.format("FOUNDRY_RIVE.Uploading", { name: file.name }), { permanent: true });
    try {
      const src = await uploadRiv(file, { dir: `rive/${game.world.id}` });
      // A new file means new inputs and properties; old values may not apply.
      await this.document.update({
        "system.src": src,
        "system.artboard": "",
        "system.stateMachine": "",
        "system.inputs": [],
        "system.properties": [],
        "system.bindings": []
      });
    } catch (err) {
      ui.notifications.error(game.i18n.format("FOUNDRY_RIVE.UploadFailed", { name: file.name, error: err.message }));
    } finally {
      ui.notifications.remove?.(notice);
    }
  }

  #destroyPlayer() {
    this.#player?.destroy();
    this.#player = null;
  }

  /** Called by the journal sheet when this page's view is closed or replaced. */
  _closeView() {
    this.#destroyPlayer();
    super._closeView();
  }

  async close(options) {
    this.#destroyPlayer();
    return super.close(options);
  }
}
