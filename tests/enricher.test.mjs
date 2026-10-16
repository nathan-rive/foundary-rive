import assert from "./assert.mjs";
import { parseOptions } from "../scripts/enricher.mjs";

export const tests = [
  ["parses quoted and bare options", () => {
    const o = parseOptions(`sm="State Machine 1" fit=cover ratio=16/9 caption='The door' align=top-left autoplay=false artboard="Main"`);
    assert.deepEqual(o, {
      aspectRatio: "16/9",
      stateMachine: "State Machine 1",
      fit: "cover",
      caption: "The door",
      alignment: "top-left",
      autoplay: false,
      artboard: "Main"
    });
  }],
  ["defaults to auto ratio and drops invalid values", () => {
    const o = parseOptions(`fit=sideways align=middle ratio="16/9;color:red" unknown=1`);
    assert.deepEqual(o, { aspectRatio: "auto" });
  }],
  ["empty options are fine", () => {
    assert.deepEqual(parseOptions(""), { aspectRatio: "auto" });
    assert.deepEqual(parseOptions(undefined), { aspectRatio: "auto" });
  }]
];
