import { MODULE_ID } from "./constants.mjs";
import { fireInput, setInput, setProperty } from "./state.mjs";

/**
 * Live GM -> player sync of state machine inputs and view model properties.
 *
 * One channel, `module.foundry-rive`, with a `type` field per message:
 *   set      {target, kind: "input"|"property", name, value}   a GM changed a value
 *   fire     {target, kind, name}                               a GM fired a trigger
 *   request  {target}                                            a client opened a target and wants its live state
 *   state    {target, to, values}                                the active GM answers a request
 *
 * A target is a Rive page's UUID. Live values are not saved to the document;
 * they last until the GM reloads, and late joiners get them via request/state.
 *
 * The sender never receives its own broadcast, so every change is applied
 * locally first, then emitted. Only messages claiming a GM sender are applied.
 * Foundry doesn't authenticate the sender of module socket messages, so a
 * player could forge one; the worst case is a changed animation on screen.
 */

const CHANNEL = `module.${MODULE_ID}`;

/** target -> Set<RivePlayer> mounted on this client */
const players = new Map();

/** target -> {input: Map<name, value>, property: Map<name, value>} live values this client knows */
const live = new Map();

export function registerSocket() {
  game.socket.on(CHANNEL, onMessage);
}

/** Makes `player` follow live changes to `target`, and asks the GM for current values. */
export function track(target, player) {
  if (!target) return;
  if (!players.has(target)) players.set(target, new Set());
  players.get(target).add(player);
  player.onDestroy(() => players.get(target)?.delete(player));
  applyKnown(target, player);
  if (!game.user.isGM) emit({ type: "request", target });
}

/** GM: change a value for everyone viewing `target`. */
export function set(target, kind, name, value) {
  if (!game.user.isGM) return;
  remember(target, kind, name, value);
  for (const player of players.get(target) ?? []) apply(player, kind, name, value);
  emitThrottled({ type: "set", target, kind, name, value });
}

/** GM: fire a trigger for everyone viewing `target`. */
export function fire(target, kind, name) {
  if (!game.user.isGM) return;
  for (const player of players.get(target) ?? []) fireOn(player, kind, name);
  emit({ type: "fire", target, kind, name });
}

/** Live values this client knows for `target`, as {input: Map, property: Map}. */
export function knownValues(target) {
  const state = live.get(target);
  return { input: new Map(state?.input), property: new Map(state?.property) };
}

/** Live values for `target` as stored-entry lists, for "save as default". */
export function liveValues(target) {
  const state = live.get(target);
  const entries = map => [...(map ?? new Map())].map(([name, value]) => ({ name, value: String(value) }));
  return { inputs: entries(state?.input), properties: entries(state?.property) };
}

function onMessage(message) {
  const sender = game.users.get(message?.senderId);
  switch (message?.type) {
    case "set":
      if (!sender?.isGM) return;
      remember(message.target, message.kind, message.name, message.value);
      for (const player of players.get(message.target) ?? []) apply(player, message.kind, message.name, message.value);
      return;
    case "fire":
      if (!sender?.isGM) return;
      for (const player of players.get(message.target) ?? []) fireOn(player, message.kind, message.name);
      return;
    case "request":
      // Only one GM answers, so players don't get duplicate replies.
      if (game.users.activeGM?.isSelf && live.has(message.target)) {
        emit({ type: "state", target: message.target, to: message.senderId, values: serialize(message.target) });
      }
      return;
    case "state":
      if (!sender?.isGM || message.to !== game.user.id) return;
      for (const [kind, entries] of Object.entries(message.values ?? {})) {
        for (const [name, value] of entries) remember(message.target, kind, name, value);
      }
      for (const player of players.get(message.target) ?? []) applyKnown(message.target, player);
      return;
  }
}

function emit(message) {
  game.socket.emit(CHANNEL, { ...message, senderId: game.user.id });
}

/** Coalesces rapid "set" messages (slider drags) per target+kind+name to one per animation frame. */
const queued = new Map();
function emitThrottled(message) {
  const key = `${message.target}|${message.kind}|${message.name}`;
  const pending = queued.has(key);
  queued.set(key, message);
  if (pending) return;
  requestAnimationFrame(() => {
    const latest = queued.get(key);
    queued.delete(key);
    emit(latest);
  });
}

function remember(target, kind, name, value) {
  if (kind !== "input" && kind !== "property") return;
  if (!live.has(target)) live.set(target, { input: new Map(), property: new Map() });
  live.get(target)[kind].set(name, value);
}

function serialize(target) {
  const state = live.get(target);
  return { input: [...state.input], property: [...state.property] };
}

function applyKnown(target, player) {
  const state = live.get(target);
  if (!state) return;
  for (const [name, value] of state.input) apply(player, "input", name, value);
  for (const [name, value] of state.property) apply(player, "property", name, value);
}

function apply(player, kind, name, value) {
  if (kind === "input") setInput(player, name, value);
  else if (kind === "property") setProperty(player, name, value);
}

function fireOn(player, kind, name) {
  if (kind === "input") fireInput(player, name);
  else if (kind === "property") setProperty(player, name, true);
}
