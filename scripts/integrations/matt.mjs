import { MODULE_ID } from "../constants.mjs";
import { riveFlags, riveState } from "../canvas/rive-canvas.mjs";
import { boundPropertyNames } from "../live-controls.mjs";
import * as sync from "../sync.mjs";

/**
 * Optional integration with Monk's Active Tile Triggers (MATT, v12 = 12.x).
 * Adds a "Rive" group of tile actions, so a tile's triggers (a token walking
 * onto it, a click, combat turns...) can set Rive values and fire Rive
 * triggers on tiles and tokens, for everyone on the scene.
 *
 * Nothing here runs unless MATT is active: it calls `setupTileActions` from
 * its own init, and that is the only entry point. MATT runs tile actions on the
 * GM's client, so changes go out through live sync like the GM live controls;
 * "Remember" also saves the value as the document's default (its
 * `flags.foundry-rive` lists), so it survives reloads.
 */
export const MATT_ID = "monks-active-tiles";
export const ACTION_SET = "set";
export const ACTION_FIRE = "fire";

/** Registers the hook MATT calls; must run before MATT's init (module evaluation is). */
export function registerMattIntegration() {
  Hooks.on("setupTileActions", app => {
    registerActions(app);
    // MATT uses Hooks.call: returning false would stop modules after us.
    return true;
  });
}

export function registerActions(app) {
  if (!app?.registerTileGroup || !app?.registerTileAction) return false;
  app.registerTileGroup(MODULE_ID, "FOUNDRY_RIVE.Matt.Group");
  app.registerTileAction(MODULE_ID, ACTION_SET, setAction(app));
  app.registerTileAction(MODULE_ID, ACTION_FIRE, fireAction(app));
  return true;
}

const entityCtrl = {
  id: "entity",
  name: "MonksActiveTiles.ctrl.select-entity",
  type: "select",
  subtype: "entity",
  options: { show: ["tile", "token", "within", "previous", "tagger"] },
  restrict: entity => entity instanceof Tile || entity instanceof Token,
  defvalue: "tile",
  defaultType: "tiles"
};

const kindCtrl = {
  id: "kind",
  name: "FOUNDRY_RIVE.Matt.Kind",
  type: "list",
  list: "kind",
  defvalue: "property"
};

const nameCtrl = helpKey => withHelp({ id: "name", name: "FOUNDRY_RIVE.Matt.Name", type: "text", required: true }, helpKey);

/** MATT shows `help` as given, and translations aren't loaded yet when it asks for actions. */
function withHelp(ctrl, key) {
  return Object.defineProperty(ctrl, "help", { get: () => game.i18n.localize(key), enumerable: true });
}

const kindValues = {
  property: "FOUNDRY_RIVE.Matt.KindProperty",
  input: "FOUNDRY_RIVE.Matt.KindInput"
};

function setAction(app) {
  return {
    name: "FOUNDRY_RIVE.Matt.SetAction",
    requiresGM: true,
    ctrls: [
      entityCtrl,
      kindCtrl,
      nameCtrl("FOUNDRY_RIVE.Matt.NameHelp"),
      withHelp({ id: "value", name: "FOUNDRY_RIVE.Matt.Value", type: "text" }, "FOUNDRY_RIVE.Matt.ValueHelp"),
      withHelp({ id: "remember", name: "FOUNDRY_RIVE.Matt.Remember", type: "checkbox" }, "FOUNDRY_RIVE.Matt.RememberHelp")
    ],
    values: { kind: kindValues },
    fn: async (args = {}) => {
      const { action } = args;
      const kind = kindOf(action);
      const name = String(action?.data?.name ?? "").trim();
      if (!name) return;
      for (const entity of await app.getEntities(args, "tiles")) {
        const value = await app.getValue(action.data.value ?? "", args, entity);
        await setRiveValue(docOf(entity), kind, name, value, { remember: Boolean(action.data.remember) });
      }
    },
    content: async (trigger, action) => {
      const entityName = await app.entityName(action.data?.entity || "tile", "tiles");
      return game.i18n.format("FOUNDRY_RIVE.Matt.SetText", {
        name: esc(action.data?.name),
        value: esc(action.data?.value),
        entity: entityName,
        remember: action.data?.remember ? game.i18n.localize("FOUNDRY_RIVE.Matt.Remembered") : ""
      });
    }
  };
}

function fireAction(app) {
  return {
    name: "FOUNDRY_RIVE.Matt.FireAction",
    requiresGM: true,
    ctrls: [entityCtrl, kindCtrl, nameCtrl("FOUNDRY_RIVE.Matt.FireHelp")],
    values: { kind: kindValues },
    fn: async (args = {}) => {
      const { action } = args;
      const name = String(action?.data?.name ?? "").trim();
      if (!name) return;
      for (const entity of await app.getEntities(args, "tiles")) fireRive(docOf(entity), kindOf(action), name);
    },
    content: async (trigger, action) => {
      const entityName = await app.entityName(action.data?.entity || "tile", "tiles");
      return game.i18n.format("FOUNDRY_RIVE.Matt.FireText", { name: esc(action.data?.name), entity: entityName });
    }
  };
}

/**
 * Sets one value on a Rive tile or token for everyone, and with `remember` also
 * stores it as the document's default. Bound properties are left alone: they
 * follow their data, and a set would only make them disagree with it.
 * @returns {Promise<boolean>} whether anything was set
 */
export async function setRiveValue(doc, kind, name, value, { remember = false } = {}) {
  if (!game.user.isGM || !isRiveDoc(doc)) return false;
  const state = riveState(doc);
  if (kind === "property" && boundPropertyNames(state.bindings).has(name)) {
    console.warn(`${MODULE_ID} | ${doc.uuid}: "${name}" is bound to data, so the tile action doesn't set it`);
    return false;
  }
  const text = String(value ?? "");
  sync.set(doc.uuid, kind, name, text);
  if (remember) {
    const key = kind === "input" ? "inputs" : "properties";
    const next = [...state[key].filter(e => e.name !== name), { name, value: text }];
    await doc.update({ [`flags.${MODULE_ID}.${key}`]: next });
  }
  return true;
}

/** Fires a trigger input or trigger property on a Rive tile or token for everyone viewing it. */
export function fireRive(doc, kind, name) {
  if (!game.user.isGM || !isRiveDoc(doc)) return false;
  sync.fire(doc.uuid, kind, name);
  return true;
}

function isRiveDoc(doc) {
  return ["Tile", "Token"].includes(doc?.documentName) && Boolean(riveFlags(doc));
}

/** MATT hands back documents, placeables or (for tokens) either. */
function docOf(entity) {
  return entity?.document ?? entity;
}

function kindOf(action) {
  return action?.data?.kind === "input" ? "input" : "property";
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}
