import assert from "./assert.mjs";
import { AUTO, initialRatio, isAspectRatio } from "../scripts/stage.mjs";

export const tests = [
  ["accepts auto and width/height ratios", () => {
    for (const v of [AUTO, "16 / 9", "4/3", "1", "1.5", "2.35 / 1"]) assert.ok(isAspectRatio(v), v);
  }],
  ["rejects anything that isn't a plain ratio (it goes into a CSS style)", () => {
    for (const v of ["", "16/9; background:red", "calc(1)", "16 / 9 !important", "url(x)", "-1", null, undefined]) {
      assert.equal(isAspectRatio(v), false, String(v));
    }
  }],
  ["auto starts at 16 / 9 until the artboard is known", () => {
    assert.equal(initialRatio(AUTO), "16 / 9");
    assert.equal(initialRatio("4/3"), "4/3");
    assert.equal(initialRatio("nonsense"), "16 / 9");
  }]
];
