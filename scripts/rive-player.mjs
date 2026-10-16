import { MAX_LIVE_PLAYERS } from "./constants.mjs";
import { fetchWrapped, isWrappedPath } from "./riv-wrapper.mjs";

/**
 * Thin, framework-agnostic wrapper around one Rive instance on one canvas.
 * Knows nothing about Foundry sheets; adapters mount and destroy it.
 */
export class RivePlayer {
  /** Every live player, so leaks show up as a growing count. */
  static live = new Set();

  /** Cap on live players; a client setting can change it. */
  static maxLive = MAX_LIVE_PLAYERS;

  /**
   * Backstop for adapters that miss a teardown: destroys players whose canvas
   * was in the page when it loaded and has since been removed.
   */
  static sweep() {
    for (const player of RivePlayer.live) {
      if (player.#wasConnected && !player.#canvas?.isConnected) player.destroy();
    }
  }

  #wasConnected = false;
  #rebindAfterLoad = false;
  #teardowns = [];

  /** Runs `fn` when the player is destroyed (e.g. to remove hooks it set up). */
  onDestroy(fn) {
    this.#teardowns.push(fn);
  }

  #rive = null;
  #canvas = null;
  #resizeObserver = null;
  #visibilityObserver = null;
  #wantsPlay = false;
  #naturalRatio = null;

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
   * @param {number} [options.layoutScale=1]  "layout" fit: canvas CSS pixels per artboard unit
   * @returns {Promise<RivePlayer>} resolves once the file has loaded
   */
  static mount(canvas, options) {
    if (RivePlayer.live.size >= RivePlayer.maxLive) {
      return Promise.reject(new Error(`Rive: live player cap (${RivePlayer.maxLive}) reached`));
    }
    const player = new RivePlayer();
    RivePlayer.live.add(player);
    return player.#load(canvas, options).then(
      () => {
        // autoBind only binds the state machines that existed at load, and the view
        // model instance isn't available yet inside onLoad. Rebind here so a state
        // machine we started afterwards sees it too; without this, view model triggers
        // (and anything else read only by state machine logic) do nothing.
        const vmi = player.#rive?.viewModelInstance;
        if (player.#rebindAfterLoad && vmi) player.#rive.bindViewModelInstance(vmi);
        return player;
      },
      err => {
        player.destroy();
        throw err;
      }
    );
  }

  get rive() {
    return this.#rive;
  }

  /**
   * The artboard's width / height as designed, as a CSS aspect-ratio, or null.
   * Captured at load: with the "layout" fit the artboard then takes the canvas's
   * size, so its live proportions are the stage's, not the file's.
   */
  get aspectRatio() {
    return this.#naturalRatio;
  }

  /** True with the "layout" fit: the artboard takes the canvas's size instead of being scaled into it. */
  get isLayoutFit() {
    return this.#rive?.layout?.fit === globalThis.rive?.Fit?.Layout;
  }

  /**
   * Layout fit only: canvas CSS pixels per artboard unit. Sizing the canvas then
   * (resizeDrawingSurfaceToCanvas) makes the artboard canvas size / scale, so a
   * file laid out for size, rather than scaled, keeps its elements the same size
   * and fits more or fewer of them.
   */
  setLayoutScale(scale) {
    const rive = this.#rive;
    if (!rive || !this.isLayoutFit || !(scale > 0) || rive.layout.layoutScaleFactor === scale) return;
    rive.layout = rive.layout.copyWith({ layoutScaleFactor: scale });
  }

  /** Artboard and state machine names from the loaded file. */
  get contents() {
    return this.#rive?.contents ?? null;
  }

  async #load(canvas, { src, buffer, artboard, stateMachine, fit = "contain", alignment = "center", autoplay = true, offscreen = false, layoutScale = 1 }) {
    const { Rive, Layout, Fit, Alignment } = globalThis.rive;
    this.#canvas = canvas;
    this.#wantsPlay = autoplay;
    // Foundry paths like "rive/world/x.riv.json" need the route prefix; URLs pass through.
    if (src && !/^([a-z][a-z\d+.-]*:|\/)/i.test(src)) src = foundry.utils.getRoute(src);
    // Uploaded files arrive as .riv.json wrappers (see riv-wrapper.mjs).
    if (src && !buffer && isWrappedPath(src)) {
      buffer = await fetchWrapped(src);
      src = undefined;
      if (!this.#canvas) throw new Error("Rive: player destroyed while loading");
    }
    return new Promise((resolve, reject) => {
      this.#rive = new Rive({
        canvas,
        src,
        buffer,
        artboard,
        stateMachines: stateMachine,
        autoplay,
        autoBind: true,
        layout: new Layout({ fit: Fit[capitalize(fit)], alignment: Alignment[camel(alignment)], layoutScaleFactor: layoutScale }),
        onLoad: () => {
          if (!this.#rive) return reject(new Error("Rive: player destroyed while loading"));
          const w = this.#rive.artboardWidth;
          const h = this.#rive.artboardHeight;
          this.#naturalRatio = w > 0 && h > 0 ? `${w} / ${h}` : null;
          // Without a named state machine Rive only plays the first timeline; prefer the artboard's first state machine.
          if (!stateMachine) {
            const board = this.#rive.contents?.artboards?.find(a => !artboard || a.name === artboard);
            const first = board?.stateMachines?.[0]?.name;
            if (first) {
              this.#rive.stop();
              this.#rive.play(first, autoplay);
              if (!autoplay) this.#rive.pause();
              this.#rebindAfterLoad = true;
            }
          }
          // A canvas managed elsewhere (a scene texture source) keeps the size it was
          // given and gets no DOM observers; its owner decides when it plays.
          if (!offscreen) {
            this.#rive.resizeDrawingSurfaceToCanvas();
            this.#wasConnected = canvas.isConnected;
            this.#observe();
          }
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

  /** Stops drawing without forgetting whether it should play (e.g. scrolled out of view). */
  suspend(suspended) {
    if (!this.#rive) return;
    if (suspended) this.#rive.pause();
    else if (this.#wantsPlay) this.#rive.play();
  }

  /** Frees the native Rive objects. Safe to call more than once. */
  destroy() {
    for (const fn of this.#teardowns.splice(0)) fn();
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
