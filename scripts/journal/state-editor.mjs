import { describe } from "../state.mjs";
import { attachSuggestions } from "../suggest.mjs";

/**
 * Builds controls for a loaded file's state machine inputs and view model
 * properties. Used two ways:
 *  - settings (journal page editor, tile/token Rive tab): values are saved as
 *    defaults; each property shows either its value or its binding, switched by
 *    a toggle; tiles and tokens can also hide items from the live controls
 *  - live controls: a GM drives the animation for everyone viewing it
 *    (continuous, nothing saved); hidden and bound items aren't shown
 * Both use the same rows: label and type, the control, then small side controls.
 * Controls are unnamed, so a surrounding sheet form never submits them.
 *
 * @param {HTMLElement} container
 * @param {RivePlayer} player
 * @param {object} config
 * @param {{input: Map, property: Map}} config.values           values to show instead of the file's own
 * @param {(kind, name, value) => void} config.onChange         value is null for "reset"
 * @param {(kind, name) => void} config.onFire
 * @param {boolean} [config.live=false]                         report every slider step, hide reset
 * @param {{list: object[], onChange: (name, binding) => void, target?: "token"|"tile"|"page"}} [config.bindings]
 *   settings: value-or-binding toggle; `target` decides which suggestions make sense
 * @param {{hidden: Set<string>, onChange: (key, hidden) => void}} [config.visibility]  settings: eye toggles (keys "kind:name")
 * @param {Set<string>} [config.hide]                           live: item keys ("kind:name") not to show
 * @param {string} [config.emptyText]                           shown when there's nothing to show
 */
export function renderStateEditor(container, player, { values, onChange, onFire, live = false, bindings, visibility, hide, emptyText }) {
  const described = describe(player);
  const shown = (kind, item) => !hide?.has(itemKey(kind, item.name));
  const inputs = described.inputs.filter(i => shown("input", i));
  const properties = described.properties.filter(p => shown("property", p));
  container.replaceChildren();
  container.classList.add("rive-state-editor");
  container.classList.toggle("rive-live-editor", live);
  if (!inputs.length && !properties.length) {
    container.append(hint(emptyText ?? game.i18n.localize("FOUNDRY_RIVE.NoState")));
    return;
  }
  const boundBy = new Map((bindings?.list ?? []).map(b => [b.name, b]));

  const section = (kind, heading, items) => {
    if (!items.length) return;
    container.append(headingEl(heading));
    for (const item of items) {
      const key = itemKey(kind, item.name);
      let main;
      let reset = null;
      if (item.type === "trigger") {
        main = fireButton(() => onFire(kind, item.name));
      } else {
        const overridden = values[kind].has(item.name);
        const current = overridden ? values[kind].get(item.name) : item.value;
        main = valueControl(item.type, current, item.options, live, value => onChange(kind, item.name, value));
        Object.assign(main.dataset, { riveKind: kind, riveName: item.name });
        if (!live && overridden) reset = resetButton(() => onChange(kind, item.name, null));
      }
      const side = [];
      let bindPane = null;
      // Properties (not triggers) can follow Foundry data instead of a set value.
      if (bindings && kind === "property" && item.type !== "trigger") {
        const toggle = bindingToggle(item.name, boundBy.get(item.name), bindings.onChange, bindings.target);
        bindPane = toggle.pane;
        side.push(toggle.switch);
      }
      if (visibility) side.push(eyeButton(key, visibility));
      // The control shows the type (a colour box, a dropdown); only the settings spell it out.
      container.append(row(item.name, live ? null : item.type, main, reset, bindPane, side));
    }
  };
  section("input", "FOUNDRY_RIVE.Inputs", inputs);
  section("property", "FOUNDRY_RIVE.Properties", properties);
}

/** "property:hp", "input:level": how items are named in hide / visibility sets. */
export function itemKey(kind, name) {
  return `${kind}:${name}`;
}

/**
 * Shows a value that changed elsewhere (another GM) in an already-built editor,
 * without firing its change handlers.
 */
export function showValue(container, kind, name, value) {
  const control = [...container.querySelectorAll("[data-rive-kind]")]
    .find(el => el.dataset.riveKind === kind && el.dataset.riveName === name);
  if (!control) return;
  for (const input of control.matches("input, select") ? [control] : control.querySelectorAll("input, select")) {
    if (input === document.activeElement) continue; // don't fight someone mid-edit
    if (input.type === "checkbox") input.checked = value === true || value === "true";
    else if (input.type === "range") {
      const { min, max } = sliderRange(Number(value), Number(input.min), Number(input.max));
      Object.assign(input, { min: String(min), max: String(max) });
      input.value = String(value);
    } else input.value = String(value ?? "");
  }
}

/**
 * Slider range for a number: 0–100 by default, grown in powers of ten to hold
 * the value (250 gives 0–1000, -5 gives -100–100), and never shrunk below a
 * range it already has.
 */
export function sliderRange(value, min = 0, max = 100) {
  const n = Number.isFinite(value) ? value : 0;
  const span = magnitude => 10 ** Math.max(2, Math.ceil(Math.log10(Math.abs(magnitude) + 1)));
  const lo = Math.min(Number.isFinite(min) ? min : 0, n < 0 ? -span(n) : 0);
  const hi = Math.max(Number.isFinite(max) ? max : 100, n > 0 ? span(n) : 100);
  return { min: lo, max: hi };
}

function valueControl(type, value, options, live, onChange) {
  // Live controls report as they move; saved controls only on commit.
  const on = (el, read) => el.addEventListener(live ? "input" : "change", () => onChange(read()));
  let el;
  switch (type) {
    case "number":
      el = Object.assign(document.createElement("input"), { type: "number", step: "any", value: value ?? "" });
      if (live) {
        // A slider is easier to drive live; keep the number box beside it for exact values.
        const { min, max } = sliderRange(Number(value));
        const range = Object.assign(document.createElement("input"), { type: "range", min, max, step: "any", value: value ?? 0 });
        const widen = n => {
          const next = sliderRange(n, Number(range.min), Number(range.max));
          Object.assign(range, { min: String(next.min), max: String(next.max) });
        };
        range.addEventListener("input", () => { el.value = range.value; onChange(range.value); });
        el.addEventListener("input", () => { if (el.value === "") return; widen(Number(el.value)); range.value = el.value; onChange(el.value); });
        const wrap = document.createElement("div");
        wrap.className = "rive-number";
        wrap.append(range, el);
        return wrap;
      }
      on(el, () => (el.value === "" ? null : el.value));
      return el;
    case "boolean":
      el = Object.assign(document.createElement("input"), { type: "checkbox", checked: value === true || value === "true" });
      el.addEventListener("change", () => onChange(el.checked));
      return el;
    case "color":
      el = Object.assign(document.createElement("input"), { type: "color", value: /^#[\da-f]{6}$/i.test(value) ? value : "#000000" });
      on(el, () => el.value);
      return el;
    case "enum":
      el = document.createElement("select");
      el.append(...(options ?? []).map(o => new Option(o, o, false, o === value)));
      el.addEventListener("change", () => onChange(el.value));
      return el;
    default:
      el = Object.assign(document.createElement("input"), { type: "text", value: value ?? "" });
      on(el, () => el.value);
      return el;
  }
}

/**
 * Suggestions for a binding's document field: `@actor` / `@token` mean the
 * token's own actor and the token itself, so they're offered only on tokens.
 * Tiles and journal pages have nothing to suggest (drop a document instead).
 */
export function documentSuggestions(target) {
  if (target !== "token") return [];
  return [
    { value: "@actor", label: game.i18n.localize("FOUNDRY_RIVE.BindActorShorthand") },
    { value: "@token", label: game.i18n.localize("FOUNDRY_RIVE.BindTokenShorthand") }
  ];
}

/**
 * Suggestions for a binding's path field: `status:<id>` for each condition this
 * world defines, but only when the document can have conditions (an actor or a
 * token, by shorthand on a token or by UUID anywhere). Otherwise none.
 */
export function pathSuggestions(target, documentField) {
  if (!canHaveConditions(target, documentField)) return [];
  return (CONFIG.statusEffects ?? [])
    .filter(status => status?.id)
    .map(status => ({ value: `status:${status.id}`, label: game.i18n.localize(status.name ?? status.label ?? status.id) }));
}

function canHaveConditions(target, documentField) {
  const value = String(documentField ?? "").trim();
  if (value === "@actor" || value === "@token") return target === "token";
  if (!value) return false;
  let doc = null;
  try {
    doc = globalThis.fromUuidSync?.(value) ?? null;
  } catch {
    return false; // not a UUID (or one in a compendium that isn't loaded)
  }
  return ["Actor", "Token"].includes(doc?.documentName);
}

/**
 * A property's switch between its value and a binding. On, the row shows the
 * binding's document and path; off, the value. Turning it off removes the
 * binding; turning it back on (before the editor is rebuilt) brings back what was
 * typed, so a slip of the switch costs nothing.
 */
function bindingToggle(name, binding, onChange, target) {
  const pane = bindingFields(binding, next => onChange(name, next), target);
  const input = Object.assign(document.createElement("input"), { type: "checkbox", checked: Boolean(binding?.uuid || binding?.path) });
  const sw = document.createElement("label");
  sw.className = "rive-switch";
  sw.dataset.tooltip = "FOUNDRY_RIVE.BindToggle";
  sw.append(input, Object.assign(document.createElement("span"), { className: "rive-switch-track" }));
  input.addEventListener("change", () => {
    const row = sw.closest(".rive-row");
    row?.classList.toggle("rive-bound", input.checked);
    if (input.checked) {
      const kept = pane.read();
      if (kept.uuid || kept.path) onChange(name, kept);
      pane.focus();
    } else onChange(name, { uuid: "", path: "" });
  });
  return { switch: sw, pane: Object.assign(pane.element, { _riveBound: input.checked }) };
}

function bindingFields(binding, onChange, target) {
  const uuid = Object.assign(document.createElement("input"), {
    type: "text",
    value: binding?.uuid ?? "",
    placeholder: game.i18n.localize("FOUNDRY_RIVE.BindUuid"),
    title: binding?.uuid ?? ""
  });
  const path = Object.assign(document.createElement("input"), {
    type: "text",
    value: binding?.path ?? "",
    placeholder: game.i18n.localize("FOUNDRY_RIVE.BindPath"),
    title: binding?.path ?? ""
  });
  const read = () => ({ uuid: uuid.value.trim(), path: path.value.trim() });
  const commit = () => {
    uuid.title = uuid.value;
    path.title = path.value;
    onChange(read());
  };
  uuid.addEventListener("change", commit);
  path.addEventListener("change", commit);
  // Dropping a document (an Actor from the sidebar, say) fills in its UUID.
  uuid.addEventListener("dragover", event => event.preventDefault());
  uuid.addEventListener("drop", event => {
    event.preventDefault();
    const data = TextEditor.getDragEventData(event);
    if (!data?.uuid) return;
    uuid.value = data.uuid;
    commit();
  });
  const element = document.createElement("div");
  element.className = "rive-bind";
  element.append(
    attachSuggestions(uuid, () => documentSuggestions(target)),
    attachSuggestions(path, () => pathSuggestions(target, uuid.value))
  );
  return { element, read, focus: () => (uuid.value ? path : uuid).focus() };
}

/** Tiles and tokens: whether an item appears in the live controls. */
function eyeButton(key, visibility) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "rive-eye";
  const paint = () => {
    const hidden = visibility.hidden.has(key);
    button.classList.toggle("hidden-live", hidden);
    button.dataset.tooltip = hidden ? "FOUNDRY_RIVE.LiveShow" : "FOUNDRY_RIVE.LiveHide";
    button.innerHTML = `<i class="fa-solid ${hidden ? "fa-eye-slash" : "fa-eye"}"></i>`;
  };
  paint();
  button.addEventListener("click", () => {
    const hidden = !visibility.hidden.has(key);
    if (hidden) visibility.hidden.add(key);
    else visibility.hidden.delete(key);
    paint();
    visibility.onChange(key, hidden);
  });
  return button;
}

function row(name, type, main, reset, bindPane, side) {
  const el = document.createElement("div");
  el.className = "form-group rive-row";
  const label = document.createElement("label");
  label.textContent = name;
  label.title = name;
  if (type) {
    const typeTag = document.createElement("span");
    typeTag.className = "rive-type";
    typeTag.textContent = type;
    label.append(" ", typeTag);
  }
  const fields = document.createElement("div");
  fields.className = "form-fields";
  const value = document.createElement("div");
  value.className = "rive-value";
  value.append(main);
  if (reset) value.append(reset);
  fields.append(value);
  if (bindPane) {
    fields.append(bindPane);
    el.classList.toggle("rive-bound", bindPane._riveBound);
  }
  if (side.length) {
    const sideEl = document.createElement("div");
    sideEl.className = "rive-side";
    sideEl.append(...side);
    fields.append(sideEl);
  }
  el.append(label, fields);
  return el;
}

function resetButton(onReset) {
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "rive-reset";
  reset.dataset.tooltip = "FOUNDRY_RIVE.Reset";
  reset.innerHTML = `<i class="fa-solid fa-rotate-left"></i>`;
  reset.addEventListener("click", onReset);
  return reset;
}

function fireButton(onFire) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "rive-fire";
  button.textContent = game.i18n.localize("FOUNDRY_RIVE.Fire");
  button.addEventListener("click", onFire);
  return button;
}

function headingEl(key) {
  const h = document.createElement("h3");
  h.className = "rive-state-heading";
  h.textContent = game.i18n.localize(key);
  return h;
}

function hint(text) {
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = text;
  return p;
}
