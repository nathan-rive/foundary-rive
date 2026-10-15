/**
 * State machine inputs and view model properties: reading what a loaded file
 * offers, applying stored values, and binding properties to Foundry data.
 * Stored values are strings; they are coerced by the type the file reports, so
 * one schema covers every type and a changed file never fails validation.
 */

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
  const rive = player.rive;
  const sm = rive?.playingStateMachineNames?.[0];
  if (!sm) return;
  const inputs = new Map((rive.stateMachineInputs(sm) ?? []).map(i => [i.name, i]));
  for (const { name, value } of entries) {
    const input = inputs.get(name);
    if (!input) continue;
    if (INPUT_TYPES[input.type] === "number") setIfFinite(input, Number(value));
    else if (INPUT_TYPES[input.type] === "boolean") input.value = toBoolean(value);
  }
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
    case "color": { const p = vm.color(name); const argb = hexToArgb(value); if (p && argb !== null) p.value = argb; return; }
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
 * @returns {() => void} stops listening
 */
export function bindProperties(player, bindings = []) {
  const stops = [];
  for (const { name, uuid, path } of bindings) {
    if (!name || !uuid || !path) continue;
    const doc = fromUuidSync(uuid);
    if (!doc) {
      console.warn(`foundry-rive | binding for "${name}": no document ${uuid}`);
      continue;
    }
    let last = foundry.utils.getProperty(doc, path);
    setProperty(player, name, last);
    const hook = `update${doc.documentName}`;
    const id = Hooks.on(hook, updated => {
      if (updated.uuid !== uuid) return;
      const value = foundry.utils.getProperty(updated, path);
      if (value === last) return;
      last = value;
      setProperty(player, name, value);
    });
    stops.push(() => Hooks.off(hook, id));
  }
  return () => stops.forEach(stop => stop());
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

/** "#rrggbb" or "#rrggbbaa" -> ARGB as a signed 32-bit int (opaque unless alpha given). */
function hexToArgb(hex) {
  const m = /^#?([\da-f]{6})([\da-f]{2})?$/i.exec(String(hex ?? ""));
  if (!m) return null;
  const alpha = m[2] ? parseInt(m[2], 16) : 0xff;
  return (alpha << 24) | parseInt(m[1], 16);
}
