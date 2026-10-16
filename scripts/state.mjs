/**
 * State machine inputs and view model properties: reading what a loaded file
 * offers, applying stored values, and binding properties to Foundry data.
 * Stored values are strings; they are coerced by the type the file reports, so
 * one schema covers every type and a changed file never fails validation.
 */

import { parseColor } from "./colors.mjs";

const INPUT_TYPES = { 56: "number", 58: "trigger", 59: "boolean" };

/** Property types we can show and store. Others (lists, images, nested models) are skipped. */
const PROPERTY_TYPES = new Set(["number", "string", "boolean", "color", "enumType", "trigger"]);

/** What the player's file offers, with current values, for building editors. */
export function describe(player) {
  const rive = player.rive;
  const stateMachine = rive?.playingStateMachineNames?.[0] ?? null;
  const inputs = (stateMachine ? rive.stateMachineInputs(stateMachine) ?? [] : [])
    .map(i => ({ name: i.name, type: INPUT_TYPES[i.type], value: i.value }))
    .filter(i => i.type);
  const vm = rive?.viewModelInstance;
  const properties = (vm?.properties ?? [])
    .filter(p => PROPERTY_TYPES.has(p.type))
    .map(p => describeProperty(vm, p));
  return { stateMachine, inputs, properties };
}

function describeProperty(vm, { name, type }) {
  switch (type) {
    case "number": return { name, type, value: vm.number(name)?.value };
    case "string": return { name, type, value: vm.string(name)?.value };
    case "boolean": return { name, type, value: vm.boolean(name)?.value };
    case "color": return { name, type, value: argbToHex(vm.color(name)?.value) };
    case "enumType": {
      const prop = vm.enum(name);
      return { name, type: "enum", value: prop?.value, options: prop?.values ?? [] };
    }
    default: return { name, type };
  }
}

/** Applies stored `[{name, value}]` entries to the playing state machine's inputs. */
export function applyInputs(player, entries = []) {
  for (const { name, value } of entries) setInput(player, name, value);
}

/** Sets one number or boolean input on the playing state machine. */
export function setInput(player, name, value) {
  const sm = player.rive?.playingStateMachineNames?.[0];
  const input = sm ? player.rive.stateMachineInputs(sm)?.find(i => i.name === name) : null;
  if (!input) return;
  if (INPUT_TYPES[input.type] === "number") setIfFinite(input, Number(value));
  else if (INPUT_TYPES[input.type] === "boolean") input.value = toBoolean(value);
}

/** Fires a trigger input by name. */
export function fireInput(player, name) {
  const sm = player.rive?.playingStateMachineNames?.[0];
  player.rive?.stateMachineInputs(sm)?.find(i => i.name === name)?.fire();
}

/** Sets one view model property from a stored (string) or live value. */
export function setProperty(player, name, value) {
  const vm = player.rive?.viewModelInstance;
  const type = vm?.properties?.find(p => p.name === name)?.type;
  switch (type) {
    case "number": return setIfFinite(vm.number(name), Number(value));
    case "string": { const p = vm.string(name); if (p) p.value = String(value ?? ""); return; }
    case "boolean": { const p = vm.boolean(name); if (p) p.value = toBoolean(value); return; }
    // Hex or a CSS color name, so bound text such as a character's eye color works.
    case "color": { const p = vm.color(name); const argb = parseColor(String(value ?? "")); if (p && argb !== null) p.value = argb; return; }
    case "enumType": { const p = vm.enum(name); if (p?.values?.includes(String(value))) p.value = String(value); return; }
    case "trigger": if (toBoolean(value)) vm.trigger(name)?.trigger(); return;
  }
}

export function applyProperties(player, entries = []) {
  for (const { name, value } of entries) setProperty(player, name, value);
}

/**
 * Keeps view model properties in step with Foundry document data.
 * @param {Array<{name: string, uuid: string, path: string}>} bindings
 * @param {object} [options]
 * @param {boolean} [options.applyNow=true]  set the current values immediately (applyInitialState
 *   passes false and sequences them itself)
 * @param {{actor?: Actor, token?: TokenDocument}} [options.context]  what `@actor` / `@token` mean
 * @returns {() => void} stops listening
 */
export function bindProperties(player, bindings = [], { applyNow = true, context } = {}) {
  const stops = [];
  for (const { name, uuid, path } of bindings) {
    if (!name || !uuid || !path) continue;
    const doc = resolveBinding(uuid, context);
    if (!doc) {
      console.warn(`foundry-rive | binding for "${name}": no document ${uuid}`);
      continue;
    }
    const watched = watchedUuids(doc);
    let last = readBinding(doc, path);
    if (applyNow) setProperty(player, name, last);
    const refresh = () => {
      const current = resolveBinding(uuid, context) ?? doc;
      const value = readBinding(current, path);
      if (value === last) return;
      last = value;
      setProperty(player, name, value);
    };
    // Statuses and effect-driven values change through Active Effects, which fire
    // their own hooks rather than the actor's. Re-read one tick later, once Foundry
    // has re-prepared the actor's derived data (such as `statuses`).
    const onChange = relevant => document => {
      if (relevant(document)) setTimeout(refresh, 0);
    };
    const hooks = [[`update${doc.documentName}`, onChange(d => watched.has(d?.uuid))]];
    if (actorOf(doc)) {
      const isOurs = effect => watched.has(effectActor(effect)?.uuid);
      if (doc.documentName !== "Actor") hooks.push(["updateActor", onChange(d => watched.has(d?.uuid))]);
      for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) hooks.push([hook, onChange(isOurs)]);
    }
    for (const [hook, fn] of hooks) {
      const id = Hooks.on(hook, fn);
      stops.push(() => Hooks.off(hook, id));
    }
  }
  return () => stops.forEach(stop => stop());
}

/**
 * The document UUIDs whose changes can change a binding on `doc`: the document,
 * its actor (for a token), and, for a token's unlinked (synthetic) actor, the base
 * actor it inherits from (a base-actor change fires the base actor's hooks only).
 */
function watchedUuids(doc) {
  const watched = new Set([doc.uuid]);
  const actor = actorOf(doc);
  if (actor) {
    watched.add(actor.uuid);
    if (actor.isToken) {
      const base = game.actors.get(actor.id);
      if (base) watched.add(base.uuid);
    }
  }
  return watched;
}

/** The actor whose statuses a document has: an actor itself, or a token's actor. */
function actorOf(doc) {
  if (doc?.documentName === "Actor") return doc;
  if (doc?.documentName === "Token") return doc.actor ?? null;
  return null;
}

/** The actor an Active Effect belongs to, directly or through an owned item. */
function effectActor(effect) {
  let parent = effect?.parent;
  if (parent?.documentName === "Item") parent = parent.parent;
  return parent?.documentName === "Actor" ? parent : null;
}

/** Shorthands a binding can use instead of a UUID: the token's own actor, or the token itself. */
export const ACTOR_SHORTHAND = "@actor";
export const TOKEN_SHORTHAND = "@token";

/** A binding path of `status:<id>` reads whether the actor has that status (condition). */
export const STATUS_PREFIX = "status:";

/** The document a binding reads: `@actor` / `@token` resolve through `context`, anything else as a UUID. */
export function resolveBinding(uuid, context) {
  if (uuid === ACTOR_SHORTHAND) return context?.actor ?? null;
  if (uuid === TOKEN_SHORTHAND) return context?.token ?? null;
  return fromUuidSync(uuid);
}

/**
 * The value a binding reads from a document: `status:<id>` is true when the
 * actor (or the token's actor) has that status effect, e.g. `status:prone`;
 * anything else is a data path such as `system.attributes.hp.value`.
 */
export function readBinding(doc, path) {
  if (typeof path === "string" && path.startsWith(STATUS_PREFIX)) {
    const id = path.slice(STATUS_PREFIX.length).trim();
    return Boolean(id && actorOf(doc)?.statuses?.has(id));
  }
  return foundry.utils.getProperty(doc, path);
}

/**
 * Brings a freshly loaded player to its starting values the same way on every
 * client: one value per frame, in the order the file lists its inputs and
 * properties. Each value comes from the highest source that has one: bound
 * document data (bound properties only), then the live GM value (sync), then
 * the stored default.
 *
 * Why: a Rive state machine can react to the order values change in, and
 * several changes in one frame can behave differently from separate ones. So
 * stacking every value into the first frame, in whatever order the sources
 * happened to be read, could leave identical values looking different on
 * different clients. Values are re-read at each step, so a live change that
 * arrives mid-sequence is never overwritten by an older one.
 *
 * @param {RivePlayer} player
 * @param {object} state
 * @param {string} [state.target]        sync target (document UUID) for live values
 * @param {object[]} [state.inputs]      stored {name, value}
 * @param {object[]} [state.properties]  stored {name, value}
 * @param {object[]} [state.bindings]    {name, uuid, path}
 * @param {(target: string) => {input: Map, property: Map}} [state.liveValues]
 * @param {{actor?: Actor}} [state.context]  what `@actor` means in bindings
 */
export async function applyInitialState(player, { target, inputs = [], properties = [], bindings = [], liveValues, context }) {
  const stored = {
    input: new Map(inputs.map(e => [e.name, e.value])),
    property: new Map(properties.map(e => [e.name, e.value]))
  };
  const bound = new Map(bindings.filter(b => b.name && b.uuid && b.path).map(b => [b.name, b]));
  const valueFor = (kind, name) => {
    // A bound property follows its data; live values only fill in if the document is gone.
    if (kind === "property" && bound.has(name)) {
      const { uuid, path } = bound.get(name);
      const doc = resolveBinding(uuid, context);
      if (doc) return { value: readBinding(doc, path) };
    }
    const live = target && liveValues ? liveValues(target)[kind] : null;
    if (live?.has(name)) return { value: live.get(name) };
    if (stored[kind].has(name)) return { value: stored[kind].get(name) };
    return null;
  };

  const { inputs: fileInputs, properties: fileProperties } = describe(player);
  const steps = [
    ...fileInputs.filter(i => i.type !== "trigger").map(i => ["input", i.name]),
    ...fileProperties.filter(p => p.type !== "trigger").map(p => ["property", p.name])
  ];
  for (const [kind, name] of steps) {
    if (!player.rive) return; // destroyed while sequencing
    const source = valueFor(kind, name);
    if (!source) continue;
    if (kind === "input") setInput(player, name, source.value);
    else setProperty(player, name, source.value);
    await afterAdvances(player, 2);
  }
}

/**
 * Resolves once the player's state machine has advanced `n` times, so each change
 * gets its own step. Waits on Rive's own Advance event rather than animation
 * frames: while Rive is paused (hidden tab, off-screen tile) the sequence waits
 * with it instead of piling changes into one frame. A player that isn't playing
 * at all doesn't advance, so it isn't waited for.
 */
function afterAdvances(player, n) {
  const rive = player.rive;
  if (!rive?.isPlaying) return Promise.resolve();
  const { Advance } = globalThis.rive.EventType;
  return new Promise(resolve => {
    let left = n;
    const done = () => {
      rive.off(Advance, onAdvance);
      resolve();
    };
    const onAdvance = () => {
      if (--left <= 0) done();
    };
    rive.on(Advance, onAdvance);
    player.onDestroy(done);
  });
}

function setIfFinite(target, n) {
  if (target && Number.isFinite(n)) target.value = n;
}

function toBoolean(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value));
}

/** ARGB int -> "#rrggbb" (alpha is kept by the file; the picker edits colour only). */
function argbToHex(argb) {
  if (typeof argb !== "number") return "#000000";
  return `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;
}
