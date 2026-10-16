import assert from "./assert.mjs";
import { registerDocument } from "./setup.mjs";
import { ACTOR_SHORTHAND, resolveBinding } from "../scripts/state.mjs";

export const tests = [
  ["@actor resolves to the token's own actor from the context", () => {
    const actor = { uuid: "Scene.s.Token.t.Actor.a" };
    assert.equal(resolveBinding(ACTOR_SHORTHAND, { actor }), actor);
  }],
  ["@actor without a token context resolves to nothing (never another document)", () => {
    assert.equal(resolveBinding(ACTOR_SHORTHAND, {}), null);
    assert.equal(resolveBinding(ACTOR_SHORTHAND, undefined), null);
  }],
  ["other bindings resolve by UUID", () => {
    const doc = { uuid: "Actor.hero" };
    registerDocument("Actor.hero", doc);
    assert.equal(resolveBinding("Actor.hero", { actor: { uuid: "x" } }), doc);
    assert.equal(resolveBinding("Actor.missing"), null);
  }]
];
