/**
 * A small suggestion menu for a text input, drawn inside the input's own sheet
 * rather than as a browser <datalist>: Chrome places datalist popups by screen
 * coordinates, which land far from the field when Foundry's interface is scaled.
 * The input keeps accepting any text; suggestions only fill it in.
 *
 * @param {HTMLInputElement} input
 * @param {() => Array<{value: string, label?: string}>} getOptions  read each time the menu opens
 * @returns {HTMLElement} the wrapper now holding the input (put it where the input was)
 */
export function attachSuggestions(input, getOptions) {
  const wrap = document.createElement("span");
  wrap.className = "rive-suggest";
  const menu = document.createElement("ul");
  menu.className = "rive-suggest-menu";
  menu.hidden = true;
  input.replaceWith?.(wrap);
  wrap.append(input, menu);
  input.setAttribute("autocomplete", "off");

  let active = -1;
  const items = () => [...menu.children];
  const close = () => {
    menu.hidden = true;
    active = -1;
  };
  const choose = option => {
    input.value = option.value;
    close();
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const open = () => {
    const matches = filterOptions(getOptions(), input.value);
    menu.replaceChildren(...matches.map(option => {
      const li = document.createElement("li");
      li.textContent = option.label && option.label !== option.value ? `${option.label} (${option.value})` : option.value;
      // mousedown, not click: the input would lose focus (and close the menu) first.
      li.addEventListener("mousedown", event => {
        event.preventDefault();
        choose(option);
      });
      return li;
    }));
    menu.hidden = matches.length === 0;
    active = -1;
  };
  const highlight = index => {
    const list = items();
    if (!list.length) return;
    active = (index + list.length) % list.length;
    list.forEach((li, i) => li.classList.toggle("active", i === active));
    list[active].scrollIntoView?.({ block: "nearest" });
  };

  input.addEventListener("focus", open);
  input.addEventListener("input", open);
  input.addEventListener("blur", close);
  input.addEventListener("keydown", event => {
    if (menu.hidden) return;
    if (event.key === "ArrowDown") highlight(active + 1);
    else if (event.key === "ArrowUp") highlight(active - 1);
    else if (event.key === "Enter" && active >= 0) {
      const matches = filterOptions(getOptions(), input.value);
      if (matches[active]) choose(matches[active]);
    } else if (event.key === "Escape") close();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  return wrap;
}

/**
 * Options whose value or label contains what's typed (any case); everything when
 * the field is empty or already holds an exact option.
 */
export function filterOptions(options = [], typed = "") {
  const text = String(typed ?? "").trim().toLowerCase();
  if (!text || options.some(o => o.value.toLowerCase() === text)) return options;
  return options.filter(o => o.value.toLowerCase().includes(text) || (o.label ?? "").toLowerCase().includes(text));
}

/** Long paths in a text field: show their end (the file name), with the whole path on hover. */
export function showPathEnd(input) {
  if (!input) return;
  input.title = input.value;
  requestAnimationFrame(() => (input.scrollLeft = input.scrollWidth));
}
