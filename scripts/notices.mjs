/**
 * User-facing notices about a loaded Rive file that plays, but not fully.
 */

/** The status-line text for a player whose scripts were refused, or "". */
export function refusedScriptsText(player) {
  const names = player?.refusedScripts ?? [];
  if (!names.length) return "";
  return game.i18n.format("FOUNDRY_RIVE.ScriptsRefused", { names: names.map(n => `"${n}"`).join(", ") });
}

/** Files already reported this session, so a scene full of copies says it once. */
const notified = new Set();

/** GM-only, once per file per session: a toast for a scene object whose scripts were refused. */
export function notifyRefusedScripts(player, src) {
  const text = refusedScriptsText(player);
  if (!text || !game.user?.isGM || notified.has(src)) return;
  notified.add(src);
  ui.notifications?.warn(`${src.split("/").pop()}: ${text}`);
}
