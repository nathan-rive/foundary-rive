import * as sync from "./sync.mjs";
import { fireInput, setProperty } from "./state.mjs";
import { itemKey, renderStateEditor, showValue } from "./journal/state-editor.mjs";
import { describe } from "./state.mjs";

/**
 * The two ways a GM edits a Rive file's inputs and view model properties, shared
 * by journal pages and scene tiles. Both take the document's stored lists
 * ({name, value} entries and {name, uuid, path} bindings) and leave saving to the
 * caller, which knows where on its document they live.
 */

/**
 * Editor for stored defaults: every change is saved; triggers only preview.
 * With `liveHidden` (tiles and tokens), each item also gets an eye toggle that
 * keeps it out of the live controls.
 * @param {(changes: {inputs?: object[], properties?: object[], bindings?: object[], liveHidden?: string[]}) => Promise} save
 */
export function renderDefaultsEditor(container, player, { inputs = [], properties = [], bindings = [], liveHidden }, save) {
  const edits = defaultsEdits({ inputs, properties, bindings, liveHidden }, save);
  renderStateEditor(container, player, {
    values: {
      input: new Map(inputs.map(e => [e.name, e.value])),
      property: new Map(properties.map(e => [e.name, e.value]))
    },
    onChange: edits.setValue,
    onFire: (kind, name) => (kind === "input" ? fireInput(player, name) : setProperty(player, name, true)),
    bindings: { list: bindings, onChange: edits.setBinding },
    visibility: liveHidden ? { hidden: new Set(liveHidden), onChange: edits.setLiveHidden } : undefined
  });
}

/**
 * Keeps the editor's own copy of the stored lists and saves the whole changed
 * list on each edit. The caller may save without re-rendering (tile and token
 * sheets do), so building on the lists it passed in would let a second edit
 * undo the first.
 */
export function defaultsEdits({ inputs = [], properties = [], bindings = [], liveHidden = [] }, save) {
  const lists = { inputs: [...inputs], properties: [...properties], bindings: [...bindings], liveHidden: [...liveHidden] };
  const commit = (key, next) => {
    lists[key] = next;
    return save({ [key]: next });
  };
  return {
    /** value null removes the stored default ("reset"). */
    setValue(kind, name, value) {
      const key = kind === "input" ? "inputs" : "properties";
      const next = lists[key].filter(e => e.name !== name);
      if (value !== null) next.push({ name, value: String(value) });
      return commit(key, next);
    },
    setBinding(name, binding) {
      const next = lists.bindings.filter(b => b.name !== name);
      if (binding.uuid || binding.path) next.push({ name, ...binding });
      return commit("bindings", next);
    },
    /** key is itemKey(kind, name); hidden items stay out of the live controls. */
    setLiveHidden(key, hidden) {
      const next = lists.liveHidden.filter(k => k !== key);
      if (hidden) next.push(key);
      return commit("liveHidden", next);
    }
  };
}

/** Names of properties that are bound to Foundry data (a binding with both a document and a path). */
export function boundPropertyNames(bindings = []) {
  return new Set(bindings.filter(b => b?.name && b.uuid && b.path).map(b => b.name));
}

/**
 * What the live controls leave out: bound properties (they follow their data,
 * and a live change would only make them disagree with it) and anything hidden
 * with the eye on a tile's or token's Rive tab. Counts only items the file has.
 * @returns {{hide: Set<string>, bound: number, hidden: number}}
 */
export function liveExclusions(player, { bindings = [], liveHidden = [] }) {
  const { inputs, properties } = describe(player);
  const present = new Set([...inputs.map(i => itemKey("input", i.name)), ...properties.map(p => itemKey("property", p.name))]);
  const bound = [...boundPropertyNames(bindings)].map(name => itemKey("property", name)).filter(k => present.has(k));
  const hidden = liveHidden.filter(k => present.has(k) && !bound.includes(k));
  return { hide: new Set([...bound, ...hidden]), bound: bound.length, hidden: hidden.length };
}

/**
 * GM live controls: changes play for every client viewing `target` (a document
 * UUID) and are not saved. Stays current when another GM changes a value.
 * Bound and hidden items aren't shown (see liveExclusions); `note`, if given, says
 * how many and why, and is emptied when nothing is left out.
 * @returns {() => void} stops listening; also runs when the player is destroyed
 */
export function mountLiveControls(container, player, { target, inputs = [], properties = [], bindings = [], liveHidden = [], note }) {
  const known = sync.knownValues(target);
  const withStored = (list, map) => {
    for (const e of list) if (!map.has(e.name)) map.set(e.name, e.value);
    return map;
  };
  const excluded = liveExclusions(player, { bindings, liveHidden });
  if (note) note.textContent = liveNoteText(excluded);
  renderStateEditor(container, player, {
    values: { input: withStored(inputs, known.input), property: withStored(properties, known.property) },
    onChange: (kind, name, value) => sync.set(target, kind, name, value),
    onFire: (kind, name) => sync.fire(target, kind, name),
    live: true,
    hide: excluded.hide,
    emptyText: game.i18n.localize(excluded.hide.size ? "FOUNDRY_RIVE.LiveAllBound" : "FOUNDRY_RIVE.NoState")
  });
  const hookId = Hooks.on(sync.CHANGED_HOOK, (changed, kind, name, value) => {
    if (changed === target) showValue(container, kind, name, value);
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    Hooks.off(sync.CHANGED_HOOK, hookId);
  };
  player.onDestroy(stop);
  return stop;
}

/** "2 bound values aren't shown; they follow their data. 9 hidden in the Rive tab." or "". */
export function liveNoteText({ bound, hidden }) {
  const parts = [];
  if (bound) parts.push(game.i18n.format(bound === 1 ? "FOUNDRY_RIVE.LiveBoundOne" : "FOUNDRY_RIVE.LiveBoundMany", { count: bound }));
  if (hidden) parts.push(game.i18n.format(hidden === 1 ? "FOUNDRY_RIVE.LiveHiddenOne" : "FOUNDRY_RIVE.LiveHiddenMany", { count: hidden }));
  return parts.join(" ");
}

/** Stored lists with the current live values for `target` written over them (bound properties excluded). */
export function withLiveValues(target, { inputs = [], properties = [], bindings = [] }) {
  const live = sync.liveValues(target);
  const bound = boundPropertyNames(bindings);
  const merge = (stored, fresh) => [...stored.filter(e => !fresh.some(f => f.name === e.name)), ...fresh];
  return { inputs: merge(inputs, live.inputs), properties: merge(properties, live.properties.filter(e => !bound.has(e.name))) };
}
