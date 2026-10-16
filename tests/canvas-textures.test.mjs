import assert from "./assert.mjs";
import { _bridgesForTests, releaseBridge, restoreTextures, tick } from "../scripts/canvas/rive-canvas.mjs";

/**
 * Before our texture is destroyed, the placeable and its mesh must point back at
 * Foundry's own: Foundry reads a tile's texture while tearing the canvas down,
 * and a destroyed one there left the Tiles layer unclickable.
 */
const EMPTY = { name: "EMPTY", baseTexture: {} };
globalThis.PIXI ??= {};
globalThis.PIXI.Texture ??= { EMPTY };
const texture = name => ({ name, destroyed: false, baseTexture: { destroyed: false } });

function setup() {
  const original = texture("foundry");
  const rive = texture("rive");
  const placeable = { texture: rive, mesh: { destroyed: false, texture: rive } };
  const bridge = { texture: rive, original: { texture: original, meshTexture: original } };
  return { original, rive, placeable, bridge };
}

export const tests = [
  ["the placeable and mesh get Foundry's texture back", () => {
    const { original, placeable, bridge } = setup();
    restoreTextures(placeable, bridge);
    assert.equal(placeable.texture, original);
    assert.equal(placeable.mesh.texture, original);
  }],
  ["an original that's gone falls back to nothing rather than a dead texture", () => {
    const { placeable, bridge } = setup();
    bridge.original.texture.baseTexture.destroyed = true;
    restoreTextures(placeable, bridge);
    assert.equal(placeable.texture, null);
    assert.equal(placeable.mesh.texture, PIXI.Texture.EMPTY);
  }],
  ["textures someone else set since are left alone", () => {
    const { placeable, bridge } = setup();
    const other = texture("other");
    placeable.texture = other;
    placeable.mesh.texture = other;
    restoreTextures(placeable, bridge);
    assert.equal(placeable.texture, other);
    assert.equal(placeable.mesh.texture, other);
  }],
  ["a destroyed mesh or a bridge without a texture is fine", () => {
    const { rive, placeable, bridge } = setup();
    placeable.mesh.destroyed = true;
    restoreTextures(placeable, bridge);
    assert.equal(placeable.mesh.texture, rive);
    restoreTextures(placeable, { texture: null });
    restoreTextures({ texture: null, mesh: null }, bridge);
  }]
];


/** A bridge whose parts record the order they were taken apart in. */
function trackedBridge(log, { playerThrows = false } = {}) {
  const { placeable, bridge } = setup();
  bridge.texture.destroy = () => log.push(`texture destroyed (placeable has ${placeable.texture.name})`);
  bridge.stop = () => log.push("stopped");
  bridge.player = { destroy: () => { log.push("player destroyed"); if (playerThrows) throw new Error("boom"); } };
  bridge.source = { remove: () => log.push("source removed") };
  return { placeable, bridge };
}

tests.push(
  ["release hands Foundry its texture back before destroying ours", () => {
    const log = [];
    const { placeable, bridge } = trackedBridge(log);
    releaseBridge(placeable, bridge);
    assert.equal(log.join(" | "), "stopped | player destroyed | texture destroyed (placeable has foundry) | source removed");
  }],
  ["a failing step doesn't stop the rest or escape into Foundry", () => {
    const log = [];
    const { placeable, bridge } = trackedBridge(log, { playerThrows: true });
    const error = console.error;
    console.error = () => {};
    try {
      releaseBridge(placeable, bridge);
    } finally {
      console.error = error;
    }
    assert.equal(log.includes("source removed") && log.some(l => l.startsWith("texture destroyed")), true);
  }],
  ["if Foundry's texture can't be handed back, ours isn't destroyed", () => {
    const log = [];
    const { placeable, bridge } = trackedBridge(log);
    Object.defineProperty(placeable, "texture", { get: () => bridge.texture, set: () => { throw new Error("read-only"); } });
    const error = console.error;
    console.error = () => {};
    try {
      releaseBridge(placeable, bridge);
    } finally {
      console.error = error;
    }
    assert.equal(log.some(l => l.startsWith("texture destroyed")), false);
    assert.equal(log.includes("source removed"), true);
  }]
);


tests.push(
  ["a bridge that throws on the ticker is stopped, the ticker carries on", () => {
    globalThis.canvas ??= {};
    globalThis.canvas.app = { renderer: { screen: { left: 0, top: 0, right: 100, bottom: 100 } } };
    const bridges = _bridgesForTests();
    const updated = [];
    const bad = { dirty: true, lastUpload: 0, texture: { baseTexture: { update: () => { throw new Error("destroyed"); } } } };
    const good = { dirty: true, lastUpload: 0, texture: { baseTexture: { update: () => updated.push("good") } } };
    bridges.set({ id: "bad" }, bad);
    bridges.set({ id: "good" }, good);
    const error = console.error;
    console.error = () => {};
    try {
      tick();
      bad.dirty = good.dirty = true;
      bad.lastUpload = good.lastUpload = 0;
      tick();
    } finally {
      console.error = error;
      bridges.clear();
    }
    assert.equal(bad.failed, true);
    assert.equal(updated.length, 2);
  }]
);
