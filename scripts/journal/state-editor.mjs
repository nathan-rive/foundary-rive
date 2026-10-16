import { describe } from "../state.mjs";

/**
 * Builds controls for a loaded file's state machine inputs and view model
 * properties. Used two ways:
 *  - edit sheet: values are saved to the page as defaults (with reset and binding rows)
 *  - live panel: a GM drives the animation for everyone viewing it (continuous, nothing saved)
 * Controls are unnamed, so a surrounding sheet form never submits them.
 *
 * @param {HTMLElement} container
 * @param {RivePlayer} player
 * @param {object} config
 * @param {{input: Map, property: Map}} config.values           values to show instead of the file's own
 * @param {(kind, name, value) => void} config.onChange         value is null for "reset"
 * @param {(kind, name) => void} config.onFire
 * @param {boolean} [config.live=false]                         report every slider step, hide reset
 * @param {{list: object[], onChange: (name, binding) => void}} [config.bindings]
 * @param {Set<string>} [config.hiddenProperties]               property names not to show (e.g. bound ones, live)
 */
export function renderStateEditor(container, player, { values, onChange, onFire, live = false, bindings, hiddenProperties }) {
  const described = describe(player);
  const inputs = described.inputs;
  const properties = described.properties.filter(p => !hiddenProperties?.has(p.name));
  container.replaceChildren();
  if (!inputs.length && !properties.length) {
    const allHidden = described.properties.length > 0;
    container.append(hint(game.i18n.localize(allHidden ? "FOUNDRY_RIVE.LiveAllBound" : "FOUNDRY_RIVE.NoState")));
    return;
  }
  const boundBy = new Map((bindings?.list ?? []).map(b => [b.name, b]));

  const section = (kind, heading, items) => {
    if (!items.length) return;
    container.append(headingEl(heading));
    for (const item of items) {
      if (item.type === "trigger") {
        container.append(row(item.name, item.type, fireButton(() => onFire(kind, item.name)), null));
        continue;
      }
      const overridden = values[kind].has(item.name);
      const current = overridden ? values[kind].get(item.name) : item.value;
      const control = valueControl(item.type, current, item.options, live, value => onChange(kind, item.name, value));
      Object.assign(control.dataset, { riveKind: kind, riveName: item.name });
      const reset = !live && overridden ? () => onChange(kind, item.name, null) : null;
      container.append(row(item.name, item.type, control, reset));
      if (bindings && kind === "property") {
        container.append(bindingRow(boundBy.get(item.name), binding => bindings.onChange(item.name, binding)));
      }
    }
  };
  section("input", "FOUNDRY_RIVE.Inputs", inputs);
  section("property", "FOUNDRY_RIVE.Properties", properties);
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
      const n = Number(value);
      if (n > Number(input.max)) input.max = String(Math.ceil(n));
      if (n < Number(input.min)) input.min = String(Math.floor(n));
      input.value = String(value);
    } else input.value = String(value ?? "");
  }
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
        const range = Object.assign(document.createElement("input"), { type: "range", min: 0, max: 100, step: "any", value: value ?? 0 });
        const widen = n => { if (n > Number(range.max)) range.max = String(Math.ceil(n)); if (n < Number(range.min)) range.min = String(Math.floor(n)); };
        widen(Number(value) || 0);
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
 * Suggestions for binding fields, shared by every editor on the page:
 * `@actor` / `@token` for the document, and `status:<id>` for each status effect
 * (condition) this world defines.
 */
function ensureBindingSuggestions() {
  if (document.getElementById("foundry-rive-binding-docs")) return;
  const docs = document.createElement("datalist");
  docs.id = "foundry-rive-binding-docs";
  docs.append(
    new Option(game.i18n.localize("FOUNDRY_RIVE.BindActorShorthand"), "@actor"),
    new Option(game.i18n.localize("FOUNDRY_RIVE.BindTokenShorthand"), "@token")
  );
  const paths = document.createElement("datalist");
  paths.id = "foundry-rive-binding-paths";
  for (const status of CONFIG.statusEffects ?? []) {
    if (!status?.id) continue;
    paths.append(new Option(game.i18n.localize(status.name ?? status.label ?? status.id), `status:${status.id}`));
  }
  document.body.append(docs, paths);
}

function bindingRow(binding, onChange) {
  ensureBindingSuggestions();
  const uuid = Object.assign(document.createElement("input"), {
    type: "text",
    value: binding?.uuid ?? "",
    placeholder: game.i18n.localize("FOUNDRY_RIVE.BindUuid")
  });
  uuid.setAttribute("list", "foundry-rive-binding-docs");
  const path = Object.assign(document.createElement("input"), {
    type: "text",
    value: binding?.path ?? "",
    placeholder: game.i18n.localize("FOUNDRY_RIVE.BindPath")
  });
  path.setAttribute("list", "foundry-rive-binding-paths");
  const commit = () => onChange({ uuid: uuid.value.trim(), path: path.value.trim() });
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

  const el = document.createElement("div");
  el.className = "form-group rive-binding";
  const label = document.createElement("label");
  label.textContent = game.i18n.localize("FOUNDRY_RIVE.BindTo");
  const fields = document.createElement("div");
  fields.className = "form-fields";
  fields.append(uuid, path);
  el.append(label, fields);
  return el;
}

function row(name, type, control, onReset) {
  const el = document.createElement("div");
  el.className = "form-group";
  const label = document.createElement("label");
  label.textContent = name;
  const typeTag = document.createElement("span");
  typeTag.className = "rive-type";
  typeTag.textContent = type;
  label.append(" ", typeTag);
  const fields = document.createElement("div");
  fields.className = "form-fields";
  fields.append(control);
  if (onReset) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "rive-reset";
    reset.dataset.tooltip = "FOUNDRY_RIVE.Reset";
    reset.innerHTML = `<i class="fa-solid fa-rotate-left"></i>`;
    reset.addEventListener("click", onReset);
    fields.append(reset);
  }
  el.append(label, fields);
  return el;
}

function fireButton(onFire) {
  const button = document.createElement("button");
  button.type = "button";
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
