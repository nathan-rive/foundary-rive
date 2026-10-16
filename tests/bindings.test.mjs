import assert from "./assert.mjs";
import { bindProperties, readBinding, resolveBinding, TOKEN_SHORTHAND } from "../scripts/state.mjs";

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

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
  return { player: { rive: { viewModelInstance: vm } }, values };
}

function fakeActor(uuid, statuses = [], extra = {}) {
  return { documentName: "Actor", uuid, id: uuid.split(".").pop(), statuses: new Set(statuses), ...extra };
}

export const tests = [
  ["status:<id> reads whether the actor has that condition", () => {
    const actor = fakeActor("Actor.a", ["prone"]);
    assert.equal(readBinding(actor, "status:prone"), true);
    assert.equal(readBinding(actor, "status:dead"), false);
    assert.equal(readBinding(actor, "status:"), false);
  }],
  ["status:<id> on a token reads its actor; on anything else it's false", () => {
    const token = { documentName: "Token", uuid: "Scene.s.Token.t", actor: fakeActor("Scene.s.Token.t.Actor.a", ["prone"]) };
    assert.equal(readBinding(token, "status:prone"), true);
    assert.equal(readBinding({ documentName: "Tile", uuid: "Scene.s.Tile.x" }, "status:prone"), false);
  }],
  ["other paths read data as before", () => {
    const actor = fakeActor("Actor.a", [], { system: { attributes: { hp: { value: 12 } } } });
    assert.equal(readBinding(actor, "system.attributes.hp.value"), 12);
  }],
  ["@token resolves to the placeable's own token", () => {
    const token = { documentName: "Token", uuid: "Scene.s.Token.t" };
    assert.equal(resolveBinding(TOKEN_SHORTHAND, { token }), token);
    assert.equal(resolveBinding(TOKEN_SHORTHAND, {}), null);
  }],
  ["a status binding follows conditions added and removed through Active Effects", async () => {
    const actor = fakeActor("Actor.hero");
    const { player, values } = fakePlayer([["prone", "boolean"]]);
    const stop = bindProperties(player, [{ name: "prone", uuid: "@actor", path: "status:prone" }], { context: { actor } });
    assert.equal(values.prone, false);
    actor.statuses.add("prone");
    Hooks.callAll("createActiveEffect", { parent: actor });
    await tick();
    assert.equal(values.prone, true);
    actor.statuses.delete("prone");
    Hooks.callAll("deleteActiveEffect", { parent: { documentName: "Item", parent: actor } }); // an item's effect
    await tick();
    assert.equal(values.prone, false);
    stop();
  }],
  ["effects on other actors are ignored", async () => {
    const actor = fakeActor("Actor.hero2");
    const other = fakeActor("Actor.villain");
    const { player, values } = fakePlayer([["prone", "boolean"]]);
    const stop = bindProperties(player, [{ name: "prone", uuid: "@actor", path: "status:prone" }], { context: { actor } });
    actor.statuses.add("prone"); // changed, but no event for this actor yet
    Hooks.callAll("createActiveEffect", { parent: other });
    await tick();
    assert.equal(values.prone, false);
    stop();
  }],
  ["an unlinked token's binding follows effects on its base actor", async () => {
    const base = fakeActor("Actor.base");
    game.actors.set("base", base);
    const synthetic = fakeActor("Scene.s.Token.t.Actor.base", [], { isToken: true });
    const { player, values } = fakePlayer([["poisoned", "boolean"]]);
    const stop = bindProperties(player, [{ name: "poisoned", uuid: "@actor", path: "status:poison" }], { context: { actor: synthetic } });
    synthetic.statuses.add("poison"); // inherited from the base actor
    Hooks.callAll("createActiveEffect", { parent: base });
    await tick();
    assert.equal(values.poisoned, true);
    stop();
  }],
  ["a @token binding follows token updates", async () => {
    const token = { documentName: "Token", uuid: "Scene.s.Token.t2", hidden: false, actor: fakeActor("Actor.t2") };
    const { player, values } = fakePlayer([["hidden", "boolean"]]);
    const stop = bindProperties(player, [{ name: "hidden", uuid: "@token", path: "hidden" }], { context: { token } });
    token.hidden = true;
    Hooks.callAll("updateToken", token);
    await tick();
    assert.equal(values.hidden, true);
    stop();
  }],
  ["unbinding stops all updates", async () => {
    const actor = fakeActor("Actor.hero3");
    const { player, values } = fakePlayer([["prone", "boolean"]]);
    const stop = bindProperties(player, [{ name: "prone", uuid: "@actor", path: "status:prone" }], { context: { actor } });
    stop();
    actor.statuses.add("prone");
    Hooks.callAll("createActiveEffect", { parent: actor });
    Hooks.callAll("updateActor", actor);
    await tick();
    assert.equal(values.prone, false);
  }]
];
