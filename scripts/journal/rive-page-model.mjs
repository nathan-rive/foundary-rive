export const FITS = {
  contain: "FOUNDRY_RIVE.Fit.contain",
  cover: "FOUNDRY_RIVE.Fit.cover",
  fill: "FOUNDRY_RIVE.Fit.fill",
  fitWidth: "FOUNDRY_RIVE.Fit.fitWidth",
  fitHeight: "FOUNDRY_RIVE.Fit.fitHeight",
  scaleDown: "FOUNDRY_RIVE.Fit.scaleDown",
  none: "FOUNDRY_RIVE.Fit.none"
};

export const ALIGNMENTS = {
  "top-left": "FOUNDRY_RIVE.Alignment.top-left",
  "top-center": "FOUNDRY_RIVE.Alignment.top-center",
  "top-right": "FOUNDRY_RIVE.Alignment.top-right",
  "center-left": "FOUNDRY_RIVE.Alignment.center-left",
  center: "FOUNDRY_RIVE.Alignment.center",
  "center-right": "FOUNDRY_RIVE.Alignment.center-right",
  "bottom-left": "FOUNDRY_RIVE.Alignment.bottom-left",
  "bottom-center": "FOUNDRY_RIVE.Alignment.bottom-center",
  "bottom-right": "FOUNDRY_RIVE.Alignment.bottom-right"
};

/** "16 / 9", "4/3", "1" — goes into a CSS aspect-ratio, so nothing else is allowed. */
const ASPECT_RATIO = /^\d+(\.\d+)?(\s*\/\s*\d+(\.\d+)?)?$/;

/** Data for a "foundry-rive.rive" journal page. */
export class RivePageModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const { StringField, BooleanField } = foundry.data.fields;
    return {
      src: new StringField({ required: true, blank: true, initial: "" }),
      artboard: new StringField({ required: true, blank: true, initial: "" }),
      stateMachine: new StringField({ required: true, blank: true, initial: "" }),
      fit: new StringField({ required: true, initial: "contain", choices: FITS }),
      alignment: new StringField({ required: true, initial: "center", choices: ALIGNMENTS }),
      aspectRatio: new StringField({
        required: true,
        initial: "16 / 9",
        validate: v => ASPECT_RATIO.test(v),
        validationError: "must look like 16 / 9"
      }),
      autoplay: new BooleanField({ initial: true }),
      caption: new StringField({ required: true, blank: true, initial: "" })
    };
  }

  /** Options for RivePlayer.mount; blank names fall back to the file's defaults. */
  get playerOptions() {
    return {
      src: this.src,
      artboard: this.artboard || undefined,
      stateMachine: this.stateMachine || undefined,
      fit: this.fit,
      alignment: this.alignment,
      autoplay: this.autoplay
    };
  }
}
