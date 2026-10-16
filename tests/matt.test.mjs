import assert from "./assert.mjs";
import { registerDocument, socket, USERS } from "./setup.mjs";
import * as sync from "../scripts/sync.mjs";
import { ACTION_FIRE, ACTION_GET, ACTION_SET, fireRive, readRiveValue, registerMattIntegration, setRiveValue, unquote } from "../scripts/integrations/matt.mjs";

/** Records what a module registers, the way MATT's registerTileGroup/registerTileAction would. */
function fakeMatt(entities = []) {
  return {
    groups: {},
    actions: {},
    registerTileGroup(namespace, name) {
      this.groups[namespace] = { name };
      return true;
    },
    registerTileAction(namespace, name, action) {
      this.actions[`${namespace}.${name}`] = action;
      return true;
    },
    entries: [],
    async getEntities(args, defaultType, entry) {
      this.entries.push(entry);
      return entities;
    },
    getValue: async val => val,
    entityName: async () => "This Tile"
  };
}

/** A Rive tile document whose updates are recorded (and applied to its flags). */
function riveTile(id, flags = {}) {
  const doc = {
    documentName: "Tile",
    uuid: `Scene.s.Tile.${id}`,
    flags: { "foundry-rive": { src: "rive/test-world/trap.riv.json", ...flags } },
    updates: [],
    async update(changes) {
      this.updates.push(changes);
      for (const [path, value] of Object.entries(changes)) this.flags["foundry-rive"][path.split(".").pop()] = value;
    }
  };
  return doc;
}

const sentFor = target => socket.sent.filter(s => s.message.target === target).map(s => s.message);
const tick = () => new Promise(resolve => setTimeout(resolve, 80)); // past sync's 50 ms throttle

registerMattIntegration();

export const tests = [
  ["MATT's setupTileActions gets a Rive group with set, fire and get actions", () => {
    const app = fakeMatt();
    Hooks.callAll("setupTileActions", app);
    assert.equal(app.groups["foundry-rive"].name, "FOUNDRY_RIVE.Matt.Group");
    assert.equal(Object.keys(app.actions).sort().join(","), [ACTION_FIRE, ACTION_GET, ACTION_SET].map(a => `foundry-rive.${a}`).join(","));
    for (const action of Object.values(app.actions)) assert.equal(action.requiresGM, true);
  }],
  ["help text is translated when MATT shows it, not when it registers", () => {
    const app = fakeMatt();
    const localize = game.i18n.localize;
    const asked = [];
    game.i18n.localize = key => (asked.push(key), key);
    Hooks.callAll("setupTileActions", app);
    assert.equal(asked.length, 0);
    const value = app.actions[`foundry-rive.${ACTION_SET}`].ctrls.find(c => c.id === "value");
    assert.equal(value.help, "FOUNDRY_RIVE.Matt.ValueHelp");
    assert.equal(asked.length, 1);
    game.i18n.localize = localize;
  }],
  ["the set action sends the value live to everyone on the scene", async () => {
    const tile = riveTile("m1");
    const app = fakeMatt([tile]);
    Hooks.callAll("setupTileActions", app);
    await app.actions[`foundry-rive.${ACTION_SET}`].fn({ action: { data: { kind: "property", name: "sprung", value: "true" } } });
    await tick();
    assert.equal(sync.knownValues(tile.uuid).property.get("sprung"), "true");
    assert.equal(sentFor(tile.uuid).some(m => m.type === "set" && m.name === "sprung" && m.value === "true"), true);
    assert.equal(tile.updates.length, 0);
  }],
  ["Remember also saves the value as the tile's default, replacing an older one", async () => {
    const tile = riveTile("m2", { properties: [{ name: "sprung", value: "false" }, { name: "label", value: "Trap" }] });
    assert.equal(await setRiveValue(tile, "property", "sprung", true, { remember: true }), true);
    assert.equal(JSON.stringify(tile.updates[0]), JSON.stringify({
      "flags.foundry-rive.properties": [{ name: "label", value: "Trap" }, { name: "sprung", value: "true" }]
    }));
  }],
  ["Remember saves inputs to the inputs list", async () => {
    const tile = riveTile("m3");
    await setRiveValue(tile, "input", "level", 3, { remember: true });
    assert.equal(JSON.stringify(tile.updates[0]), JSON.stringify({ "flags.foundry-rive.inputs": [{ name: "level", value: "3" }] }));
  }],
  ["bound properties are left alone", async () => {
    const tile = riveTile("m4", { bindings: [{ name: "hp", uuid: "@actor", path: "system.hp" }] });
    const warn = console.warn;
    console.warn = () => {};
    assert.equal(await setRiveValue(tile, "property", "hp", 1, { remember: true }), false);
    console.warn = warn;
    assert.equal(sync.knownValues(tile.uuid).property.has("hp"), false);
    assert.equal(tile.updates.length, 0);
  }],
  ["documents without Rive, and other document types, are skipped", async () => {
    const plain = { documentName: "Tile", uuid: "Scene.s.Tile.plain", flags: {}, update: () => assert.fail("updated") };
    const wall = { documentName: "Wall", uuid: "Scene.s.Wall.w", flags: { "foundry-rive": { src: "x" } }, update: () => assert.fail("updated") };
    assert.equal(await setRiveValue(plain, "property", "x", 1, { remember: true }), false);
    assert.equal(await setRiveValue(wall, "property", "x", 1, { remember: true }), false);
    assert.equal(fireRive(plain, "property", "x"), false);
  }],
  ["the fire action fires live for everyone, writing nothing", async () => {
    const tile = riveTile("m5");
    const app = fakeMatt([{ document: tile }]); // MATT may hand back the placeable
    Hooks.callAll("setupTileActions", app);
    await app.actions[`foundry-rive.${ACTION_FIRE}`].fn({ action: { data: { kind: "input", name: "spring" } } });
    assert.equal(sentFor(tile.uuid).some(m => m.type === "fire" && m.kind === "input" && m.name === "spring"), true);
    assert.equal(tile.updates.length, 0);
  }],
  ["get reads bound data first, then the live value, then the stored default, typed for MATT", async () => {
    registerDocument("Actor.trapper", { documentName: "Actor", uuid: "Actor.trapper", statuses: new Set(["prone"]), system: { hp: 4 } });
    const tile = riveTile("g1", {
      bindings: [{ name: "hp", uuid: "Actor.trapper", path: "system.hp" }, { name: "down", uuid: "Actor.trapper", path: "status:prone" }],
      properties: [{ name: "hp", value: "10" }, { name: "sprung", value: "false" }, { name: "label", value: "Trap" }, { name: "count", value: "2" }],
      inputs: [{ name: "level", value: "3" }]
    });
    sync.set(tile.uuid, "property", "label", "Open");
    assert.equal(readRiveValue(tile, "property", "hp"), 4);
    assert.equal(readRiveValue(tile, "property", "down"), true);
    assert.equal(readRiveValue(tile, "property", "label"), "Open");
    assert.equal(readRiveValue(tile, "property", "sprung"), false);
    assert.equal(readRiveValue(tile, "property", "count"), 2);
    assert.equal(readRiveValue(tile, "input", "level"), 3);
    assert.equal(readRiveValue(tile, "property", "unknown"), null);
  }],
  ["the get action puts the value under value.rive.<variable> for later actions", async () => {
    const tile = riveTile("g2", { properties: [{ name: "sprung", value: "true" }] });
    const app = fakeMatt([tile]);
    Hooks.callAll("setupTileActions", app);
    const get = app.actions[`foundry-rive.${ACTION_GET}`];
    assert.equal(JSON.stringify(await get.fn({ action: { data: { kind: "property", name: "sprung" } } })), JSON.stringify({ rive: { sprung: true } }));
    assert.equal(JSON.stringify(await get.fn({ action: { data: { kind: "property", name: "sprung", variable: "trap" } } })), JSON.stringify({ rive: { trap: true } }));
  }],
  ["get skips entities without Rive and writes nothing", async () => {
    const plain = { documentName: "Tile", uuid: "Scene.s.Tile.plain2", flags: {}, update: () => assert.fail("updated") };
    const tile = riveTile("g3", { properties: [{ name: "x", value: "a" }] });
    const app = fakeMatt([plain, tile]);
    Hooks.callAll("setupTileActions", app);
    const result = await app.actions[`foundry-rive.${ACTION_GET}`].fn({ action: { data: { kind: "property", name: "x" } } });
    assert.equal(result.rive.x, "a");
    assert.equal(tile.updates.length, 0);
    assert.equal(readRiveValue(plain, "property", "x"), null);
  }],
  ["a blank entity means This Tile, not MATT's fallback to the triggering token", async () => {
    const app = fakeMatt([]);
    Hooks.callAll("setupTileActions", app);
    for (const entity of ["", undefined, null, {}]) {
      await app.actions[`foundry-rive.${ACTION_SET}`].fn({ action: { data: { entity, kind: "property", name: "state", value: "active" } } });
    }
    assert.equal(JSON.stringify(app.entries), JSON.stringify([{ id: "tile" }, { id: "tile" }, { id: "tile" }, { id: "tile" }]));
    app.entries.length = 0;
    await app.actions[`foundry-rive.${ACTION_FIRE}`].fn({ action: { data: { entity: "", kind: "property", name: "go" } } });
    await app.actions[`foundry-rive.${ACTION_GET}`].fn({ action: { data: { entity: "", kind: "property", name: "state" } } });
    await app.actions[`foundry-rive.${ACTION_SET}`].fn({ action: { data: { entity: { id: "token" }, kind: "property", name: "state", value: "x" } } });
    assert.equal(JSON.stringify(app.entries), JSON.stringify([{ id: "tile" }, { id: "tile" }, undefined]));
  }],
  ["quoted values lose one pair of quotes", () => {
    assert.equal(unquote('"active"'), "active");
    assert.equal(unquote("'active'"), "active");
    assert.equal(unquote(' "two words" '), "two words");
    assert.equal(unquote('"mismatched\''), '"mismatched\'');
    assert.equal(unquote('say "hi"'), 'say "hi"');
    assert.equal(unquote(7), 7);
  }],
  ["setting an enum with a quoted value sets the option", async () => {
    const tile = riveTile("q1");
    const app = fakeMatt([tile]);
    Hooks.callAll("setupTileActions", app);
    await app.actions[`foundry-rive.${ACTION_SET}`].fn({ action: { data: { entity: "", kind: "property", name: "state", value: '"active"', remember: true } } });
    assert.equal(sync.knownValues(tile.uuid).property.get("state"), "active");
    assert.equal(JSON.stringify(tile.updates[0]), JSON.stringify({ "flags.foundry-rive.properties": [{ name: "state", value: "active" }] }));
  }],
  ["players can't set or fire (MATT runs actions on the GM)", async () => {
    const tile = riveTile("m6");
    game.user = USERS.player;
    try {
      assert.equal(await setRiveValue(tile, "property", "x", 1, { remember: true }), false);
      assert.equal(fireRive(tile, "property", "x"), false);
    } finally {
      game.user = USERS.gm;
    }
    assert.equal(tile.updates.length, 0);
  }]
];
