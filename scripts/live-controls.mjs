import * as sync from "./sync.mjs";
import { fireInput, setProperty } from "./state.mjs";
import { renderStateEditor, showValue } from "./journal/state-editor.mjs";

/**
 * The two ways a GM edits a Rive file's inputs and view model properties, shared
 * by journal pages and scene tiles. Both take the document's stored lists
 * ({name, value} entries and {name, uuid, path} bindings) and leave saving to the
 * caller, which knows where on its document they live.
 */

/**
 * Editor for stored defaults: every change is saved; triggers only preview.
 * @param {(changes: {inputs?: object[], properties?: object[], bindings?: object[]}) => Promise} save
 */
export function renderDefaultsEditor(container, player, { inputs = [], properties = [], bindings = [] }, save) {
  const edits = defaultsEdits({ inputs, properties, bindings }, save);
  renderStateEditor(container, player, {
    values: {
      input: new Map(inputs.map(e => [e.name, e.value])),
      property: new Map(properties.map(e => [e.name, e.value]))
    },
    onChange: edits.setValue,
    onFire: (kind, name) => (kind === "input" ? fireInput(player, name) : setProperty(player, name, true)),
    bindings: { list: bindings, onChange: edits.setBinding }
  });
}

/**
 * Keeps the editor's own copy of the stored lists and saves the whole changed
 * list on each edit. The caller may save without re-rendering (tile and token
 * sheets do), so building on the lists it passed in would let a second edit
 * undo the first.
 */
export function defaultsEdits({ inputs = [], properties = [], bindings = [] }, save) {
  const lists = { inputs: [...inputs], properties: [...properties], bindings: [...bindings] };
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
    }
  };
}

/** Names of properties that are bound to Foundry data (a binding with both a document and a path). */
export function boundPropertyNames(bindings = []) {
  return new Set(bindings.filter(b => b?.name && b.uuid && b.path).map(b => b.name));
}

/**
 * GM live controls: changes play for every client viewing `target` (a document
 * UUID) and are not saved. Stays current when another GM changes a value.
 * Bound properties aren't shown: they follow their data, and a live change would
 * only make them disagree with it.
 * @returns {() => void} stops listening; also runs when the player is destroyed
 */
export function mountLiveControls(container, player, { target, inputs = [], properties = [], bindings = [] }) {
  const known = sync.knownValues(target);
  const withStored = (list, map) => {
    for (const e of list) if (!map.has(e.name)) map.set(e.name, e.value);
    return map;
  };
  renderStateEditor(container, player, {
    values: { input: withStored(inputs, known.input), property: withStored(properties, known.property) },
    onChange: (kind, name, value) => sync.set(target, kind, name, value),
    onFire: (kind, name) => sync.fire(target, kind, name),
    live: true,
    hiddenProperties: boundPropertyNames(bindings)
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

/** Stored lists with the current live values for `target` written over them (bound properties excluded). */
export function withLiveValues(target, { inputs = [], properties = [], bindings = [] }) {
  const live = sync.liveValues(target);
  const bound = boundPropertyNames(bindings);
  const merge = (stored, fresh) => [...stored.filter(e => !fresh.some(f => f.name === e.name)), ...fresh];
  return { inputs: merge(inputs, live.inputs), properties: merge(properties, live.properties.filter(e => !bound.has(e.name))) };
}
