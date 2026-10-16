import assert from "./assert.mjs";
import { NAMED_COLORS, parseColor } from "../scripts/colors.mjs";
import { setProperty } from "../scripts/state.mjs";

const argb = (rgb, alpha = 0xff) => (alpha << 24) | rgb;

export const tests = [
  ["hex in every CSS form, with or without #", () => {
    assert.equal(parseColor("#3a7bd5"), argb(0x3a7bd5));
    assert.equal(parseColor("3A7BD5"), argb(0x3a7bd5));
    assert.equal(parseColor("#fff"), argb(0xffffff));
    assert.equal(parseColor("#f008"), argb(0xff0000, 0x88));
    assert.equal(parseColor("#ff000080"), argb(0xff0000, 0x80));
  }],
  ["CSS color names, ignoring case, spaces, hyphens and underscores", () => {
    assert.equal(parseColor("blue"), argb(0x0000ff));
    assert.equal(parseColor("Goldenrod"), argb(0xdaa520));
    assert.equal(parseColor("Light Blue"), argb(0xadd8e6));
    assert.equal(parseColor(" dark-red "), argb(0x8b0000));
    assert.equal(parseColor("rebecca_purple"), argb(0x663399));
    assert.equal(parseColor("grey"), parseColor("gray"));
    assert.equal(parseColor("transparent"), 0);
  }],
  ["anything else isn't a color", () => {
    for (const v of ["auburn", "blue-ish", "#12345", "#ggg", "rgb(1,2,3)", "", "   ", null, undefined, 42]) {
      assert.equal(parseColor(v), null, String(v));
    }
  }],
  ["the table has every CSS named color", () => {
    assert.equal(Object.keys(NAMED_COLORS).length, 148);
    for (const hex of Object.values(NAMED_COLORS)) assert.match(hex, /^[\da-f]{6}$/);
  }],
  ["a color property takes bound text such as a bio's eye color", () => {
    let value;
    const vm = { properties: [{ name: "eyeColor", type: "color" }], color: () => ({ set value(v) { value = v; }, get value() { return value; } }) };
    const player = { rive: { viewModelInstance: vm } };
    setProperty(player, "eyeColor", "Hazel Green"); // not a color: ignored
    assert.equal(value, undefined);
    setProperty(player, "eyeColor", "Sea Green");
    assert.equal(value, argb(0x2e8b57));
    setProperty(player, "eyeColor", "#3a7bd5");
    assert.equal(value, argb(0x3a7bd5));
  }]
];
