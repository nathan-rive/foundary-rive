/** Shared sizing for the box a player draws in (journal pages and inline embeds). */

export const AUTO = "auto";

/** "16 / 9", "4/3", "1" or "auto" — goes into a CSS aspect-ratio, so nothing else is allowed. */
const ASPECT_RATIO = /^\d+(\.\d+)?(\s*\/\s*\d+(\.\d+)?)?$/;

export function isAspectRatio(value) {
  return value === AUTO || ASPECT_RATIO.test(value ?? "");
}

/** The ratio to render before load; "auto" starts at 16 / 9 until the artboard is known. */
export function initialRatio(value) {
  return value === AUTO || !isAspectRatio(value) ? "16 / 9" : value;
}

/** For "auto", match the stage to the loaded artboard's proportions. */
export function fitStage(stage, player, value) {
  if (value !== AUTO || !stage) return;
  const ratio = player.aspectRatio;
  if (ratio) stage.style.aspectRatio = ratio;
}
