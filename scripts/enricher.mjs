import { MODULE_ID } from "./constants.mjs";
import { RivePlayer } from "./rive-player.mjs";
import { ALIGNMENTS, FITS } from "./journal/rive-page-model.mjs";
import { AUTO, fitStage, initialRatio, isAspectRatio } from "./stage.mjs";

/**
 * Inline embeds in any enriched text (journal text pages, chat, item descriptions):
 *   @Rive[rive/world/door.riv.json]
 *   @Rive[https://example.com/door.riv]{sm="State Machine 1" fit=cover ratio=1 caption="The door"}
 * The v12 enricher can only return an element, which is serialized to HTML, so
 * players are mounted afterwards by activateEmbeds when the element enters the page.
 */

const PATTERN = /@Rive\[([^\]]+)\](?:\{([^}]*)\})?/gi;
const OPTION = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;

/** Option names people may write, mapped to player option names. */
const KEYS = {
  artboard: "artboard",
  sm: "stateMachine",
  statemachine: "stateMachine",
  fit: "fit",
  align: "alignment",
  alignment: "alignment",
  ratio: "aspectRatio",
  aspect: "aspectRatio",
  autoplay: "autoplay",
  caption: "caption"
};

/** Parses `key=value key="two words"` and drops anything invalid. */
export function parseOptions(text = "") {
  const options = { aspectRatio: AUTO };
  for (const [, rawKey, dq, sq, bare] of text.matchAll(OPTION)) {
    const key = KEYS[rawKey.toLowerCase()];
    const value = dq ?? sq ?? bare;
    if (!key) continue;
    if (key === "fit" && !(value in FITS)) continue;
    if (key === "alignment" && !(value in ALIGNMENTS)) continue;
    if (key === "aspectRatio" && !isAspectRatio(value)) continue;
    options[key] = key === "autoplay" ? !/^(false|no|0|off)$/i.test(value) : value;
  }
  return options;
}

export function registerEnricher() {
  CONFIG.TextEditor.enrichers.push({ pattern: PATTERN, enricher: enrich });
}

async function enrich(match) {
  const [, src, optionText] = match;
  const options = parseOptions(optionText);

  const figure = document.createElement("figure");
  figure.className = "rive-figure rive-inline";
  figure.dataset.riveSrc = src.trim();
  figure.dataset.riveOptions = JSON.stringify(options);

  const stage = document.createElement("div");
  stage.className = "rive-stage";
  stage.style.aspectRatio = initialRatio(options.aspectRatio);
  const canvas = document.createElement("canvas");
  canvas.className = "rive-canvas";
  stage.append(canvas);

  const status = document.createElement("p");
  status.className = "rive-status";
  figure.append(stage, status);

  if (options.caption) {
    const caption = document.createElement("figcaption");
    caption.textContent = options.caption;
    figure.append(caption);
  }
  return figure;
}

/** Mounts a player in every embed under `root` that doesn't have one yet. */
export function activateEmbeds(root = document.body) {
  for (const figure of root.querySelectorAll(".rive-inline:not([data-rive-mounted])")) mountEmbed(figure);
}

async function mountEmbed(figure) {
  figure.dataset.riveMounted = "true";
  const canvas = figure.querySelector("canvas.rive-canvas");
  const status = figure.querySelector(".rive-status");
  let options;
  try {
    options = JSON.parse(figure.dataset.riveOptions ?? "{}");
  } catch {
    options = {};
  }
  try {
    const player = await RivePlayer.mount(canvas, { ...options, src: figure.dataset.riveSrc });
    if (!canvas.isConnected) return player.destroy();
    fitStage(figure.querySelector(".rive-stage"), player, options.aspectRatio);
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
    if (status) status.textContent = game.i18n.format("FOUNDRY_RIVE.LoadFailed", { error: err.message });
  }
}
