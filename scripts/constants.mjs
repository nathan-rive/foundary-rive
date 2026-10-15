export const MODULE_ID = "foundry-rive";

/** Path to the self-hosted WASM, relative to the Foundry route prefix. */
export const WASM_PATH = `modules/${MODULE_ID}/lib/rive.wasm`;

/** Upper bound on live players, so a runaway page can't starve the scene canvas. */
export const MAX_LIVE_PLAYERS = 32;

/** Public sample used by the Phase 0 test dialog until we have our own files. */
export const SAMPLE_RIV = "https://cdn.rive.app/animations/vehicles.riv";
