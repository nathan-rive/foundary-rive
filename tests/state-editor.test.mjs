import assert from "./assert.mjs";
import { parseHTML } from "linkedom";
import { documentSuggestions, itemKey, pathSuggestions, renderStateEditor, sliderRange } from "../scripts/journal/state-editor.mjs";
import { registerDocument } from "./setup.mjs";
import { defaultsEdits, liveExclusions, liveNoteText } from "../scripts/live-controls.mjs";
import { filterOptions } from "../scripts/suggest.mjs";

/** A player whose view model has the given [name, type] properties and state machine the given [name, type] inputs. */
function fakePlayer(props = [], inputs = []) {
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
  const smInputs = inputs.map(([name, type]) => ({ name, type: { number: 56, boolean: 59, trigger: 58 }[type], value: 0 }));
  const rive = { viewModelInstance: vm, playingStateMachineNames: inputs.length ? ["SM"] : [], stateMachineInputs: () => smInputs };
  return { rive, onDestroy() {} };
}

/** Runs fn with a linkedom document as the global one (the editor builds elements with it). */
function withDom(fn) {
  const { document, Event } = parseHTML("<html><body><div id=c></div></body></html>");
  const before = globalThis.document;
  globalThis.document = document;
  globalThis.CONFIG ??= {};
  try {
    return fn(document.getElementById("c"), Event);
  } finally {
    globalThis.document = before;
  }
}

const rows = container => [...container.querySelectorAll(".rive-row")].map(row => ({
  name: row.querySelector("label").firstChild.textContent,
  bound: row.classList.contains("rive-bound"),
  toggle: row.querySelector(".rive-switch input"),
  eye: row.querySelector(".rive-eye")
}));

export const tests = [
  ["binding suggestions: @actor/@token only on tokens", () => {
    assert.equal(documentSuggestions("token").map(o => o.value).join(), "@actor,@token");
    assert.equal(documentSuggestions("tile").length, 0);
    assert.equal(documentSuggestions("page").length, 0);
  }],
  ["binding suggestions: conditions only for documents that can have them", () => {
    globalThis.CONFIG ??= {};
    const saved = CONFIG.statusEffects;
    CONFIG.statusEffects = [{ id: "prone", name: "Prone" }, { id: "blind", name: "Blind" }];
    registerDocument("Actor.sugg", { documentName: "Actor", uuid: "Actor.sugg" });
    registerDocument("JournalEntry.sugg", { documentName: "JournalEntry", uuid: "JournalEntry.sugg" });
    try {
      assert.equal(pathSuggestions("token", "@actor").length, 2);
      assert.equal(pathSuggestions("token", "@token").length, 2);
      assert.equal(pathSuggestions("tile", "@actor").length, 0); // no actor on a tile
      assert.equal(pathSuggestions("tile", "").length, 0);
      assert.equal(pathSuggestions("tile", "Actor.sugg").map(o => o.value).join(), "status:prone,status:blind");
      assert.equal(pathSuggestions("page", "JournalEntry.sugg").length, 0);
      assert.equal(pathSuggestions("tile", "not a uuid").length, 0);
    } finally {
      CONFIG.statusEffects = saved;
    }
  }],
  ["live controls don't spell out types; the settings do", () => withDom(container => {
    const player = fakePlayer([["hp", "number"]]);
    const base = { values: { input: new Map(), property: new Map() }, onChange: () => {}, onFire: () => {} };
    renderStateEditor(container, player, { ...base, live: true });
    assert.equal(container.querySelectorAll(".rive-type").length, 0);
    renderStateEditor(container, player, base);
    assert.equal(container.querySelector(".rive-type")?.textContent, "number");
  })],
  ["slider ranges grow in powers of ten to hold the value", () => {
    assert.deepEqual(sliderRange(0), { min: 0, max: 100 });
    assert.deepEqual(sliderRange(30), { min: 0, max: 100 });
    assert.deepEqual(sliderRange(250), { min: 0, max: 1000 });
    assert.deepEqual(sliderRange(-5), { min: -100, max: 100 });
    assert.deepEqual(sliderRange(5, 0, 1000), { min: 0, max: 1000 }); // never shrinks
    assert.deepEqual(sliderRange(NaN), { min: 0, max: 100 });
  }],
  ["suggestions match the value or the label, and show all for an exact or empty field", () => {
    const options = [{ value: "status:prone", label: "Prone" }, { value: "status:blind", label: "Blind" }];
    assert.equal(filterOptions(options, "").length, 2);
    assert.equal(filterOptions(options, "PRO").map(o => o.value).join(), "status:prone");
    assert.equal(filterOptions(options, "blind").length, 1);
    assert.equal(filterOptions(options, "status:prone").length, 2);
    assert.equal(filterOptions(options, "zzz").length, 0);
  }],
  ["live controls leave out bound and hidden items that the file has", () => {
    const player = fakePlayer([["hp", "number"], ["hair", "string"], ["mood", "string"]], [["level", "number"]]);
    const result = liveExclusions(player, {
      bindings: [{ name: "hp", uuid: "@actor", path: "system.hp" }, { name: "gone", uuid: "@actor", path: "x" }],
      liveHidden: ["property:hair", "input:level", "property:hp", "property:missing"]
    });
    assert.equal([...result.hide].sort().join(), "input:level,property:hair,property:hp");
    assert.equal(result.bound, 1);
    assert.equal(result.hidden, 2); // hp counts as bound, not hidden; missing isn't in the file
  }],
  ["the live note is empty when nothing is left out", () => {
    assert.equal(liveNoteText({ bound: 0, hidden: 0 }), "");
    assert.equal(liveNoteText({ bound: 1, hidden: 0 }), "FOUNDRY_RIVE.LiveBoundOne");
    assert.equal(liveNoteText({ bound: 2, hidden: 3 }), "FOUNDRY_RIVE.LiveBoundMany FOUNDRY_RIVE.LiveHiddenMany");
  }],
  ["hiding and showing items saves the whole list", () => {
    const saved = [];
    const edits = defaultsEdits({ liveHidden: ["property:a"] }, changes => saved.push(changes));
    edits.setLiveHidden("property:b", true);
    edits.setLiveHidden("property:a", false);
    edits.setLiveHidden("property:b", true); // no duplicates
    assert.equal(JSON.stringify(saved.at(-1).liveHidden), JSON.stringify(["property:b"]));
  }],
  ["settings: a property shows its value or its binding, switched by the toggle", () => withDom((container, Event) => {
    const player = fakePlayer([["hp", "number"], ["mood", "string"]]);
    const changes = [];
    renderStateEditor(container, player, {
      values: { input: new Map(), property: new Map() },
      onChange: () => {},
      onFire: () => {},
      bindings: { list: [{ name: "hp", uuid: "@actor", path: "system.hp" }], onChange: (name, binding) => changes.push([name, binding]) }
    });
    let [hp, mood] = rows(container);
    assert.equal(hp.bound, true);
    assert.equal(mood.bound, false);
    // Turning hp's toggle off removes the binding and shows the value.
    hp.toggle.checked = false;
    hp.toggle.dispatchEvent(new Event("change"));
    assert.equal(JSON.stringify(changes.at(-1)), JSON.stringify(["hp", { uuid: "", path: "" }]));
    assert.equal(rows(container)[0].bound, false);
    // Turning it back on brings back what was typed.
    hp = rows(container)[0];
    hp.toggle.checked = true;
    hp.toggle.dispatchEvent(new Event("change"));
    assert.equal(JSON.stringify(changes.at(-1)), JSON.stringify(["hp", { uuid: "@actor", path: "system.hp" }]));
    assert.equal(rows(container)[0].bound, true);
  })],
  ["settings: eye toggles only with visibility (tiles and tokens), and they report the item key", () => withDom((container, Event) => {
    const player = fakePlayer([["hp", "number"]], [["level", "number"]]);
    const base = { values: { input: new Map(), property: new Map() }, onChange: () => {}, onFire: () => {} };
    renderStateEditor(container, player, base);
    assert.equal(rows(container).some(r => r.eye), false);
    const toggled = [];
    renderStateEditor(container, player, { ...base, visibility: { hidden: new Set(["input:level"]), onChange: (key, hidden) => toggled.push([key, hidden]) } });
    const [level, hp] = rows(container);
    assert.equal(level.eye.classList.contains("hidden-live"), true);
    hp.eye.dispatchEvent(new Event("click"));
    level.eye.dispatchEvent(new Event("click"));
    assert.equal(JSON.stringify(toggled), JSON.stringify([["property:hp", true], ["input:level", false]]));
  })],
  ["live: hidden items aren't drawn, and an empty list says why", () => withDom(container => {
    const player = fakePlayer([["hp", "number"], ["mood", "string"]]);
    const base = { values: { input: new Map(), property: new Map() }, onChange: () => {}, onFire: () => {}, live: true };
    renderStateEditor(container, player, { ...base, hide: new Set([itemKey("property", "hp")]) });
    assert.equal(rows(container).map(r => r.name).join(), "mood");
    assert.equal(rows(container)[0].toggle, null); // no binding toggle live
    renderStateEditor(container, player, { ...base, hide: new Set(["property:hp", "property:mood"]), emptyText: "all hidden" });
    assert.equal(container.textContent.trim(), "all hidden");
  })]
];
