/**
 * Foundry's server only accepts uploads with listed extensions, and `.riv`
 * isn't one. We upload `<name>.riv.json` files instead:
 *   { "format": "rive", "version": 1, "name": "<name>.riv", "data": "<base64 .riv bytes>" }
 * The server compresses JSON in transit, which recovers most of base64's size cost.
 */

export const WRAPPER_FORMAT = "rive";
export const WRAPPER_VERSION = 1;
export const WRAPPED_SUFFIX = ".riv.json";

export function isWrappedPath(path) {
  return /\.json(\?.*)?$/i.test(path ?? "");
}

/** @returns {ArrayBuffer} the .riv bytes inside a parsed wrapper */
export function unwrap(json) {
  if (json?.format !== WRAPPER_FORMAT || typeof json.data !== "string") {
    throw new Error("Rive: not a wrapped .riv file");
  }
  if (json.version > WRAPPER_VERSION) {
    throw new Error(`Rive: wrapper version ${json.version} is newer than this module supports`);
  }
  const bin = atob(json.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Fetches a wrapped file and returns its .riv bytes. */
export async function fetchWrapped(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Rive: ${src} returned HTTP ${res.status}`);
  return unwrap(await res.json());
}

/**
 * Wraps .riv bytes for upload.
 * @param {File|Blob|ArrayBuffer} riv
 * @param {string} name original file name, e.g. "door.riv"
 * @returns {Promise<File>} "<base>.riv.json"
 */
export async function wrap(riv, name) {
  const bytes = new Uint8Array(riv instanceof ArrayBuffer ? riv : await riv.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const body = JSON.stringify({ format: WRAPPER_FORMAT, version: WRAPPER_VERSION, name, data: btoa(bin) });
  const base = name.replace(/\.riv$/i, "");
  return new File([body], `${base}${WRAPPED_SUFFIX}`, { type: "application/json" });
}

/**
 * Wraps and uploads a .riv through Foundry's normal upload path.
 * @returns {Promise<string>} the uploaded path, usable as a player `src`
 */
export async function uploadRiv(file, { source = "data", dir = "rive" } = {}) {
  const wrapped = await wrap(file, file.name);
  await FilePicker.createDirectory(source, dir).catch(() => {});
  const response = await FilePicker.upload(source, dir, wrapped, {}, { notify: false });
  if (!response?.path) throw new Error(`Rive: upload of ${file.name} failed`);
  return response.path;
}
