import { MAX_LIVE_PLAYERS } from "./constants.mjs";

/**
 * Thin, framework-agnostic wrapper around one Rive instance on one canvas.
 * Knows nothing about Foundry sheets; adapters mount and destroy it.
 */
export class RivePlayer {
  /** Every live player, so leaks show up as a growing count. */
  static live = new Set();

  #rive = null;
  #canvas = null;
  #resizeObserver = null;
  #visibilityObserver = null;
  #wantsPlay = false;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} options
   * @param {string} [options.src]             URL of the .riv file
   * @param {ArrayBuffer} [options.buffer]     Raw .riv bytes, instead of src
   * @param {string} [options.artboard]
   * @param {string} [options.stateMachine]
   * @param {string} [options.fit="contain"]   A rive.Fit key, lowercase
   * @param {string} [options.alignment="center"]
   * @param {boolean} [options.autoplay=true]
   * @returns {Promise<RivePlayer>} resolves once the file has loaded
   */
  static mount(canvas, options) {
    if (RivePlayer.live.size >= MAX_LIVE_PLAYERS) {
      return Promise.reject(new Error(`Rive: live player cap (${MAX_LIVE_PLAYERS}) reached`));
    }
    const player = new RivePlayer();
    RivePlayer.live.add(player);
    return player.#load(canvas, options).catch(err => {
      player.destroy();
      throw err;
    });
  }

  get rive() {
    return this.#rive;
  }

  /** Artboard and state machine names from the loaded file. */
  get contents() {
    return this.#rive?.contents ?? null;
  }

  #load(canvas, { src, buffer, artboard, stateMachine, fit = "contain", alignment = "center", autoplay = true }) {
    const { Rive, Layout, Fit, Alignment } = globalThis.rive;
    this.#canvas = canvas;
    this.#wantsPlay = autoplay;
    return new Promise((resolve, reject) => {
      this.#rive = new Rive({
        canvas,
        src,
        buffer,
        artboard,
        stateMachines: stateMachine,
        autoplay,
        autoBind: true,
        layout: new Layout({ fit: Fit[capitalize(fit)], alignment: Alignment[camel(alignment)] }),
        onLoad: () => {
          this.#rive.resizeDrawingSurfaceToCanvas();
          this.#observe();
          resolve(this);
        },
        onLoadError: e => reject(new Error(`Rive: failed to load ${src ?? "buffer"}: ${e?.data ?? e}`))
      });
    });
  }

  #observe() {
    this.#resizeObserver = new ResizeObserver(() => this.#rive?.resizeDrawingSurfaceToCanvas());
    this.#resizeObserver.observe(this.#canvas);

    // Off-screen players stop drawing; they resume only if they were playing.
    this.#visibilityObserver = new IntersectionObserver(([entry]) => {
      if (!this.#rive) return;
      if (entry.isIntersecting && this.#wantsPlay) this.#rive.play();
      else if (!entry.isIntersecting) this.#rive.pause();
    });
    this.#visibilityObserver.observe(this.#canvas);
  }

  play() {
    this.#wantsPlay = true;
    this.#rive?.play();
  }

  pause() {
    this.#wantsPlay = false;
    this.#rive?.pause();
  }

  /** Frees the native Rive objects. Safe to call more than once. */
  destroy() {
    this.#resizeObserver?.disconnect();
    this.#visibilityObserver?.disconnect();
    this.#rive?.cleanup();
    this.#rive = null;
    this.#canvas = null;
    RivePlayer.live.delete(this);
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "top-left" -> "TopLeft", "center" -> "Center" */
function camel(s) {
  return s.split("-").map(capitalize).join("");
}
