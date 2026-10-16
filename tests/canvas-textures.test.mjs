import assert from "./assert.mjs";
import { restoreTextures } from "../scripts/canvas/rive-canvas.mjs";

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
