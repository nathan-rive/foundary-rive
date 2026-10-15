import { describe, fireInput, setProperty } from "../state.mjs";

/**
 * Builds the "Inputs" and "Properties" controls in the page edit sheet from
 * what the loaded file offers. Controls are unnamed so the sheet's form submit
 * ignores them; each change is saved through `save(changes)` instead.
 *
 * @param {HTMLElement} container
 * @param {RivePlayer} player
 * @param {object} system      the page's system data
 * @param {(changes: object) => Promise} save
 */
export function renderStateEditor(container, player, system, save) {
  const { inputs, properties } = describe(player);
  container.replaceChildren();
  if (!inputs.length && !properties.length) {
    container.append(hint(game.i18n.localize("FOUNDRY_RIVE.NoState")));
    return;
  }

  const stored = list => new Map(list.map(e => [e.name, e.value]));
  const savedInputs = stored(system.inputs);
  const savedProps = stored(system.properties);
  const bindings = new Map(system.bindings.map(b => [b.name, b]));

  /** Replaces or removes one `{name, value}` entry in a stored list. */
  const writeEntry = (key, list, name, value) => {
    const next = list.filter(e => e.name !== name);
    if (value !== null) next.push({ name, value: String(value) });
    return save({ [`system.${key}`]: next });
  };

  if (inputs.length) {
    container.append(heading("FOUNDRY_RIVE.Inputs"));
    for (const input of inputs) {
      const current = savedInputs.has(input.name) ? savedInputs.get(input.name) : input.value;
      const control = input.type === "trigger"
        ? fireButton(() => fireInput(player, input.name))
        : valueControl(input.type, current, null, value => writeEntry("inputs", system.inputs, input.name, value));
      container.append(row(input.name, input.type, control, savedInputs.has(input.name) && input.type !== "trigger"
        ? () => writeEntry("inputs", system.inputs, input.name, null) : null));
    }
  }

  if (properties.length) {
    container.append(heading("FOUNDRY_RIVE.Properties"));
    for (const prop of properties) {
      if (prop.type === "trigger") {
        container.append(row(prop.name, prop.type, fireButton(() => setProperty(player, prop.name, true)), null));
        continue;
      }
      const current = savedProps.has(prop.name) ? savedProps.get(prop.name) : prop.value;
      const control = valueControl(prop.type, current, prop.options, value => writeEntry("properties", system.properties, prop.name, value));
      container.append(row(prop.name, prop.type, control, savedProps.has(prop.name)
        ? () => writeEntry("properties", system.properties, prop.name, null) : null));
      container.append(bindingRow(prop.name, bindings.get(prop.name), binding => {
        const next = system.bindings.filter(b => b.name !== prop.name);
        if (binding.uuid || binding.path) next.push({ name: prop.name, ...binding });
        return save({ "system.bindings": next });
      }));
    }
  }
}

function valueControl(type, value, options, onChange) {
  let el;
  switch (type) {
    case "number":
      el = Object.assign(document.createElement("input"), { type: "number", step: "any", value: value ?? "" });
      el.addEventListener("change", () => onChange(el.value === "" ? null : el.value));
      break;
    case "boolean":
      el = Object.assign(document.createElement("input"), { type: "checkbox", checked: value === true || value === "true" });
      el.addEventListener("change", () => onChange(el.checked));
      break;
    case "color":
      el = Object.assign(document.createElement("input"), { type: "color", value: /^#[\da-f]{6}$/i.test(value) ? value : "#000000" });
      el.addEventListener("change", () => onChange(el.value));
      break;
    case "enum":
      el = document.createElement("select");
      el.append(...(options ?? []).map(o => new Option(o, o, false, o === value)));
      el.addEventListener("change", () => onChange(el.value));
      break;
    default:
      el = Object.assign(document.createElement("input"), { type: "text", value: value ?? "" });
      el.addEventListener("change", () => onChange(el.value));
  }
  return el;
}

function bindingRow(name, binding, onChange) {
  const uuid = Object.assign(document.createElement("input"), {
    type: "text",
    value: binding?.uuid ?? "",
    placeholder: game.i18n.localize("FOUNDRY_RIVE.BindUuid")
  });
  const path = Object.assign(document.createElement("input"), {
    type: "text",
    value: binding?.path ?? "",
    placeholder: game.i18n.localize("FOUNDRY_RIVE.BindPath")
  });
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

function heading(key) {
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
