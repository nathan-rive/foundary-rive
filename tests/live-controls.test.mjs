import assert from "./assert.mjs";
import { socket, USERS } from "./setup.mjs";
import * as sync from "../scripts/sync.mjs";
import { boundPropertyNames, defaultsEdits, withLiveValues } from "../scripts/live-controls.mjs";
import { applyInitialState } from "../scripts/state.mjs";

sync.registerSocket(); // a repeat registration is harmless: the same version is only taken once

const setLive = (target, name, value, clock) =>
  socket.receive("module.foundry-rive", { type: "set", target, kind: "property", name, value, clock, senderId: USERS.gm.id });

/** A player whose view model has the given [name, type] properties; `values` records what was set. */
function fakePlayer(props) {
  const values = {};
  const accessor = name => ({
    get value() {
      return values[name];
    },
    set value(v) {
      values[name] = v;
    }
  });
  const vm = { properties: props.map(([name, type]) => ({ name, type })), boolean: accessor, number: accessor, string: accessor };
  return { player: { rive: { viewModelInstance: vm }, onDestroy() {} }, values };
}

export const tests = [
  ["several binding edits without a re-render all stick", () => {
    const saved = [];
    const edits = defaultsEdits({ bindings: [{ name: "a", uuid: "@actor", path: "old" }] }, changes => saved.push(changes));
    edits.setBinding("b", { uuid: "@actor", path: "status:prone" });
    edits.setBinding("c", { uuid: "@token", path: "hidden" });
    edits.setBinding("a", { uuid: "", path: "" }); // cleared
    assert.equal(JSON.stringify(saved.at(-1).bindings), JSON.stringify([
      { name: "b", uuid: "@actor", path: "status:prone" },
      { name: "c", uuid: "@token", path: "hidden" }
    ]));
  }],
  ["several value edits without a re-render all stick", () => {
    const saved = [];
    const edits = defaultsEdits({ properties: [{ name: "x", value: "1" }] }, changes => saved.push(changes));
    edits.setValue("property", "y", 2);
    edits.setValue("property", "x", null);
    edits.setValue("input", "go", true);
    edits.setValue("property", "z", "red");
    assert.equal(JSON.stringify(saved.at(-1).properties), JSON.stringify([{ name: "y", value: "2" }, { name: "z", value: "red" }]));
    assert.equal(JSON.stringify(saved.find(c => c.inputs).inputs), JSON.stringify([{ name: "go", value: "true" }]));
  }],
  ["only complete bindings count as bound", () => {
    const names = boundPropertyNames([
      { name: "hp", uuid: "@actor", path: "system.attributes.hp.value" },
      { name: "half", uuid: "@actor", path: "" },
      { name: "none", uuid: "", path: "hidden" }
    ]);
    assert.equal([...names].join(","), "hp");
  }],
  ["save as defaults leaves bound properties out", () => {
    setLive("Scene.s.Token.lc1", "hp", "3", 1);
    setLive("Scene.s.Token.lc1", "label", "hi", 2);
    const merged = withLiveValues("Scene.s.Token.lc1", {
      properties: [{ name: "hp", value: "10" }],
      bindings: [{ name: "hp", uuid: "@actor", path: "system.attributes.hp.value" }]
    });
    assert.equal(JSON.stringify(merged.properties), JSON.stringify([{ name: "hp", value: "10" }, { name: "label", value: "hi" }]));
  }],
  ["at start-up a bound property takes its data over a live value", async () => {
    const actor = { documentName: "Actor", uuid: "Actor.lc", statuses: new Set(), system: { hp: 7 }, name: "Hero" };
    const { player, values } = fakePlayer([["hp", "number"], ["label", "string"]]);
    await applyInitialState(player, {
      target: "T",
      properties: [{ name: "label", value: "stored" }],
      bindings: [{ name: "hp", uuid: "@actor", path: "system.hp" }],
      liveValues: () => ({ input: new Map(), property: new Map([["hp", "99"], ["label", "live"]]) }),
      context: { actor }
    });
    assert.equal(values.hp, 7);
    assert.equal(values.label, "live");
  }],
  ["a bound property whose document is gone falls back to the live value", async () => {
    const { player, values } = fakePlayer([["hp", "number"]]);
    await applyInitialState(player, {
      target: "T",
      bindings: [{ name: "hp", uuid: "@actor", path: "system.hp" }],
      liveValues: () => ({ input: new Map(), property: new Map([["hp", "99"]]) }),
      context: {}
    });
    assert.equal(values.hp, 99);
  }]
];
