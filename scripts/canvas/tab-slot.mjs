/**
 * Where to add a tab to a v12 (AppV1) config sheet that other modules may also
 * have changed. Rules, so their tabs can't swallow ours:
 *  - Use the sheet's own tab controllers (`app._tabs`) when it has them: the
 *    first whose nav isn't inside a tab is the sheet's main tab bar. Sub-tab
 *    bars nested in a tab (Monk's Active Tile Triggers puts one in Triggers;
 *    core TokenConfig has light and vision ones) are skipped.
 *  - Our tab goes right after the last top-level tab that this nav lists: not
 *    inside another tab, in the nav's group, and with a matching nav item. Tabs
 *    another module adds, wrappers around the tab panels, or panels it adds
 *    later don't change that.
 *  - If no such place exists, there's no slot: better no Rive tab than one
 *    that breaks the sheet.
 *
 * @param {Element} root  the sheet's element
 * @param {object[]} [controllers]  the sheet's Tabs controllers (`app._tabs`)
 * @returns {{nav: Element, group?: string, after: Element, controller: object|null}|null}
 */
export function findTabSlot(root, controllers = []) {
  for (const candidate of navCandidates(root, controllers)) {
    const after = topLevelTabs(candidate).at(-1);
    if (after) return { ...candidate, after };
  }
  return null;
}

function navCandidates(root, controllers) {
  const query = selector => {
    if (!selector) return null;
    try {
      return root.querySelector(selector);
    } catch {
      return null; // a selector the DOM can't parse
    }
  };
  const candidates = [];
  for (const controller of controllers ?? []) {
    const nav = query(controller?._navSelector);
    if (!nav || nav.closest(".tab")) continue;
    candidates.push({ nav, group: nav.dataset.group, content: query(controller._contentSelector) ?? root, controller });
  }
  if (candidates.length) return candidates;
  // No controllers to go by: the main tab bar from the DOM.
  const nav = root.querySelector('nav.sheet-tabs[data-group="main"]')
    ?? [...root.querySelectorAll("nav.sheet-tabs, nav.tabs")].find(n => !n.closest(".tab"));
  return nav ? [{ nav, group: nav.dataset.group, content: root, controller: null }] : [];
}

function topLevelTabs({ nav, group, content }) {
  const listed = new Set([...nav.querySelectorAll("[data-tab]")].map(item => item.dataset.tab));
  return [...content.querySelectorAll(".tab[data-tab]")].filter(tab =>
    !tab.parentElement?.closest(".tab")
    && (group ? tab.dataset.group === group : true)
    && listed.has(tab.dataset.tab)
    && tab.dataset.tab !== "rive");
}
