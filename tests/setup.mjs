/**
 * Minimal stand-ins for the Foundry globals the tested modules touch, so pure
 * logic can run in Node. Only what the suites need; extend as tests grow.
 */

const gm = { id: "gm-1", isGM: true };
const otherGm = { id: "gm-2", isGM: true };
const player = { id: "player-1", isGM: false };
const users = new Map([gm, otherGm, player].map(u => [u.id, u]));

export const socket = {
  handlers: new Map(),
  sent: [],
  on(channel, fn) {
    this.handlers.set(channel, fn);
  },
  emit(channel, message) {
    this.sent.push({ channel, message });
  },
  /** Delivers a message to this client's handler, as if another client sent it. */
  receive(channel, message) {
    this.handlers.get(channel)?.(message);
  }
};

globalThis.game = {
  user: gm,
  users: Object.assign(users, { activeGM: gm }),
  socket,
  world: { id: "test-world" },
  actors: new Map(),
  modules: new Map(),
  i18n: { localize: key => key, format: key => key }
};

globalThis.Hooks = {
  calls: [],
  handlers: new Map(),
  nextId: 1,
  callAll(name, ...args) {
    this.calls.push({ name, args });
    for (const fn of this.handlers.get(name)?.values() ?? []) fn(...args);
  },
  on(name, fn) {
    const id = this.nextId++;
    if (!this.handlers.has(name)) this.handlers.set(name, new Map());
    this.handlers.get(name).set(id, fn);
    return id;
  },
  off(name, id) {
    this.handlers.get(name)?.delete(id);
  }
};

const documents = new Map();
export function registerDocument(uuid, doc) {
  documents.set(uuid, doc);
}
globalThis.fromUuidSync = uuid => documents.get(uuid) ?? null;

globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: { fields: {} },
  utils: {
    getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj),
    getRoute: path => `/${path}`
  }
};

export const USERS = { gm, otherGm, player };
