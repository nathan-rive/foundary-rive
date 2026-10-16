import { MODULE_ID } from "./constants.mjs";
import { fireInput, setInput, setProperty } from "./state.mjs";

/**
 * Live GM -> player sync of state machine inputs and view model properties.
 *
 * One channel, `module.foundry-rive`, with a `type` field per message:
 *   set      {target, kind: "input"|"property", name, value, clock}   a GM changed a value
 *   fire     {target, kind, name}                                      a GM fired a trigger
 *   request  {target}                                                   a client opened a target and wants its live state
 *   state    {target, to, values}                                       a GM answers a request
 * Every message also carries `senderId`.
 *
 * A target is a Rive page's UUID. Live values are not saved to the document;
 * they last while any GM who saw them stays connected.
 *
 * Several GMs can edit at once, so every value carries a version: a Lamport
 * clock plus the editing user's id. A client keeps a value only if its version
 * is newer than the one it has, so all clients settle on the same winner no
 * matter what order messages arrive in. Late joiners (GMs included) ask for
 * current values, and every GM who has them answers; duplicate answers merge
 * by version, so they're harmless.
 *
 * The sender never receives its own broadcast, so every change is applied
 * locally first, then emitted. Only messages claiming a GM sender are applied.
 * Foundry doesn't authenticate the sender of module socket messages, so a
 * player could forge one; the worst case is a changed animation on screen.
 */

const CHANNEL = `module.${MODULE_ID}`;

/** Hook called on this client whenever a live value is accepted: (target, kind, name, value). */
export const CHANGED_HOOK = `${MODULE_ID}.liveChanged`;

/** target -> Set<RivePlayer> mounted on this client */
const players = new Map();

/** target -> {input: Map<name, Entry>, property: Map<name, Entry>}; Entry = {value, clock, by} */
const live = new Map();

/** Lamport clock: always ahead of every version this client has seen. */
let clock = 0;

export function registerSocket() {
  game.socket.on(CHANNEL, onMessage);
}

/** Makes `player` follow live changes to `target`, and asks the GMs for current values. */
export function track(target, player, { applyNow = true } = {}) {
  if (!target) return;
  if (!players.has(target)) players.set(target, new Set());
  players.get(target).add(player);
  player.onDestroy(() => players.get(target)?.delete(player));
  if (applyNow) applyKnown(target, player);
  emit({ type: "request", target });
}

/** GM: change a value for everyone viewing `target`. */
export function set(target, kind, name, value) {
  if (!game.user.isGM) return;
  const version = { clock: ++clock, by: game.user.id };
  if (!accept(target, kind, name, value, version)) return;
  emitThrottled({ type: "set", target, kind, name, value, ...version });
}

/** GM: fire a trigger for everyone viewing `target`. */
export function fire(target, kind, name) {
  if (!game.user.isGM) return;
  for (const player of players.get(target) ?? []) fireOn(player, kind, name);
  emit({ type: "fire", target, kind, name });
}

/** Live values this client knows for `target`, as {input: Map<name, value>, property: Map<name, value>}. */
export function knownValues(target) {
  const state = live.get(target);
  const values = map => new Map([...(map ?? [])].map(([name, entry]) => [name, entry.value]));
  return { input: values(state?.input), property: values(state?.property) };
}

/** Live values for `target` as stored-entry lists, for "save as default". */
export function liveValues(target) {
  const { input, property } = knownValues(target);
  const entries = map => [...map].map(([name, value]) => ({ name, value: String(value) }));
  return { inputs: entries(input), properties: entries(property) };
}

function onMessage(message) {
  const sender = game.users.get(message?.senderId);
  switch (message?.type) {
    case "set":
      if (!sender?.isGM) return;
      accept(message.target, message.kind, message.name, message.value, { clock: message.clock, by: message.senderId });
      return;
    case "fire":
      if (!sender?.isGM) return;
      for (const player of players.get(message.target) ?? []) fireOn(player, message.kind, message.name);
      return;
    case "request":
      // Every GM who knows values answers; the requester merges answers by version.
      if (game.user.isGM && live.has(message.target)) {
        emit({ type: "state", target: message.target, to: message.senderId, values: serialize(message.target) });
      }
      return;
    case "state":
      if (!sender?.isGM || message.to !== game.user.id) return;
      for (const kind of ["input", "property"]) {
        for (const [name, entry] of message.values?.[kind] ?? []) {
          accept(message.target, kind, name, entry.value, { clock: entry.clock, by: entry.by });
        }
      }
      return;
  }
}

/**
 * Keeps a value if its version is newer than the one this client has, then
 * applies it to mounted players and tells open panels.
 * @returns {boolean} whether the value was kept
 */
function accept(target, kind, name, value, version) {
  if (kind !== "input" && kind !== "property") return false;
  if (!Number.isFinite(version?.clock) || typeof version.by !== "string") return false;
  clock = Math.max(clock, version.clock);
  if (!live.has(target)) live.set(target, { input: new Map(), property: new Map() });
  const entries = live.get(target)[kind];
  const current = entries.get(name);
  if (current && !newer(version, current)) return false;
  entries.set(name, { value, ...version });
  for (const player of players.get(target) ?? []) apply(player, kind, name, value);
  Hooks.callAll(CHANGED_HOOK, target, kind, name, value);
  return true;
}

/** Higher clock wins; equal clocks (true concurrency) fall back to user id, so every client picks the same one. */
function newer(a, b) {
  return a.clock !== b.clock ? a.clock > b.clock : a.by > b.by;
}

function emit(message) {
  game.socket.emit(CHANNEL, { ...message, senderId: game.user.id });
}

/**
 * Coalesces rapid "set" messages (slider drags) per target+kind+name to at most
 * one per 50 ms. A timer, not requestAnimationFrame: browsers pause animation
 * frames in background tabs, which would hold a GM's edits back.
 */
const queued = new Map();
const THROTTLE_MS = 50;
function emitThrottled(message) {
  const key = `${message.target}|${message.kind}|${message.name}`;
  const pending = queued.has(key);
  queued.set(key, message);
  if (pending) return;
  setTimeout(() => {
    const latest = queued.get(key);
    queued.delete(key);
    emit(latest);
  }, THROTTLE_MS);
}

function serialize(target) {
  const state = live.get(target);
  return { input: [...state.input], property: [...state.property] };
}

/** Re-applies the live values this client knows for `target` (e.g. after stored defaults were re-applied). */
export function applyKnown(target, player) {
  const state = live.get(target);
  if (!state) return;
  for (const [name, entry] of state.input) apply(player, "input", name, entry.value);
  for (const [name, entry] of state.property) apply(player, "property", name, entry.value);
}

function apply(player, kind, name, value) {
  if (kind === "input") setInput(player, name, value);
  else if (kind === "property") setProperty(player, name, value);
}

function fireOn(player, kind, name) {
  if (kind === "input") fireInput(player, name);
  else if (kind === "property") setProperty(player, name, true);
}
