import assert from "./assert.mjs";
import { parseHTML } from "linkedom";
import { findTabSlot } from "../scripts/canvas/tab-slot.mjs";

/**
 * Config sheet layouts as Foundry v12 and other modules leave them, to check the
 * Rive tab always lands in the sheet's main tab bar. CI installs linkedom for these.
 */
const sheet = body => parseHTML(`<html><body><div class="app">${body}</div></body></html>`).document.querySelector(".app");
const nav = (tabs, attrs = 'class="sheet-tabs tabs"') => `<nav ${attrs}>${tabs.map(t => `<a class="item" data-tab="${t}"></a>`).join("")}</nav>`;
const panels = (tabs, group) => tabs.map(t => `<div class="tab" data-tab="${t}"${group ? ` data-group="${group}"` : ""}></div>`).join("");
const slotOf = (root, controllers) => {
  const slot = findTabSlot(root, controllers);
  return slot && { after: slot.after.dataset.tab, group: slot.group ?? null, nav: slot.nav.className, controller: slot.controller };
};

const TILE_TABS = ["basic", "overhead", "animation"];
const coreTile = () => sheet(`<form>${nav(TILE_TABS)}${panels(TILE_TABS)}</form>`);
const tileControllers = [{ _navSelector: ".tabs", _contentSelector: "form" }];

/** Monk's Active Tile Triggers 12.02: a Triggers tab holding its own sub-tab bar and panels. */
const mattTile = () => sheet(`<form>
  ${nav([...TILE_TABS, "triggers"])}
  ${panels(TILE_TABS)}
  <div class="tab" data-tab="triggers">
    ${nav(["trigger-setup", "trigger-actions", "trigger-images"], 'class="trigger-tabs sheet-tabs tabs" data-group="triggers"')}
    ${panels(["trigger-setup", "trigger-actions", "trigger-images"])}
  </div>
</form>`);
const mattControllers = [
  { _navSelector: ".sheet-tabs:not(.trigger-tabs)", _contentSelector: "form" },
  { _navSelector: '.tabs[data-group="triggers"]', _contentSelector: '.tab[data-tab="triggers"]' }
];

const TOKEN_TABS = ["identity", "appearance", "vision", "light", "resources"];
/** Core v12 TokenConfig: a "main" group, with light's own sub-tabs nested in its panel. */
const coreToken = () => sheet(`<form>
  ${nav(TOKEN_TABS, 'class="sheet-tabs tabs" data-group="main"')}
  ${panels(["identity", "appearance", "vision"], "main")}
  <div class="tab" data-tab="light" data-group="main">
    ${nav(["basic", "animation"], 'class="sheet-tabs tabs" data-group="light"')}
    ${panels(["basic", "animation"], "light")}
  </div>
  ${panels(["resources"], "main")}
</form>`);
const tokenControllers = [
  { _navSelector: '.tabs[data-group="main"]', _contentSelector: "form" },
  { _navSelector: '.tabs[data-group="light"]', _contentSelector: '.tab[data-tab="light"]' }
];

export const tests = [
  ["core tile config: after the last core tab", () => {
    assert.equal(slotOf(coreTile(), tileControllers).after, "animation");
  }],
  ["MATT's nested Triggers sub-tabs don't take the Rive tab", () => {
    const slot = slotOf(mattTile(), mattControllers);
    assert.equal(slot.after, "triggers");
    assert.equal(slot.controller, mattControllers[0]);
  }],
  ["...even when only the DOM is there to go by", () => {
    assert.equal(slotOf(mattTile(), []).after, "triggers");
    assert.equal(slotOf(mattTile(), undefined).after, "triggers");
  }],
  ["...or a sub-tab controller is listed first", () => {
    assert.equal(slotOf(mattTile(), [...mattControllers].reverse()).after, "triggers");
  }],
  ["core token config: main group, not light's sub-tabs", () => {
    const slot = slotOf(coreToken(), tokenControllers);
    assert.equal(slot.after, "resources");
    assert.equal(slot.group, "main");
    assert.equal(slot.controller, tokenControllers[0]);
    assert.equal(slotOf(coreToken(), []).after, "resources");
  }],
  ["tab panels inside a wrapper (sheet body) still count", () => {
    const root = sheet(`<form>${nav(TILE_TABS)}<section class="sheet-body">${panels(TILE_TABS)}</section></form>`);
    const slot = findTabSlot(root, tileControllers);
    assert.equal(slot.after.dataset.tab, "animation");
    assert.equal(slot.after.parentElement.className, "sheet-body");
  }],
  ["a panel another module added without a nav item is skipped", () => {
    const root = sheet(`<form>${nav(TILE_TABS)}${panels(TILE_TABS)}<div class="tab" data-tab="orphan"></div></form>`);
    assert.equal(slotOf(root, tileControllers).after, "animation");
  }],
  ["another module's top-level tab: ours goes after it", () => {
    const root = sheet(`<form>${nav([...TILE_TABS, "other"])}${panels([...TILE_TABS, "other"])}</form>`);
    assert.equal(slotOf(root, tileControllers).after, "other");
  }],
  ["a selector the DOM can't parse falls back to the DOM", () => {
    assert.equal(slotOf(mattTile(), [{ _navSelector: "nav[[", _contentSelector: "form" }]).after, "triggers");
  }],
  ["no tab bar at all: no slot, so no Rive tab", () => {
    assert.equal(findTabSlot(sheet(`<form><div class="tab" data-tab="basic"></div></form>`), []), null);
    assert.equal(findTabSlot(sheet(`<form>${nav(["basic"])}</form>`), tileControllers), null);
  }],
  ["an existing Rive panel isn't a place to go after", () => {
    const root = sheet(`<form>${nav([...TILE_TABS, "rive"])}${panels([...TILE_TABS, "rive"])}</form>`);
    assert.equal(slotOf(root, tileControllers).after, "animation");
  }]
];
