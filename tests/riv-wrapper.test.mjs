import assert from "./assert.mjs";
import { isAllowedUploadDir, isWrappedPath, unwrap, uploadRiv, uploadRoot, wrap } from "../scripts/riv-wrapper.mjs";

export const tests = [
  ["wrap then unwrap returns the same bytes", async () => {
    const bytes = new Uint8Array(70000).map((_, i) => (i * 31) & 0xff);
    const file = await wrap(bytes.buffer, "door.riv");
    assert.equal(file.name, "door.riv.json");
    const json = JSON.parse(await file.text());
    assert.equal(json.format, "rive");
    assert.deepEqual(new Uint8Array(unwrap(json)), bytes);
  }],
  ["unwrap refuses files that aren't wrapped .riv", () => {
    assert.throws(() => unwrap({ format: "other", data: "" }));
    assert.throws(() => unwrap({ format: "rive" }));
    assert.throws(() => unwrap({ format: "rive", version: 99, data: "" }));
  }],
  ["recognises wrapped paths", () => {
    assert.ok(isWrappedPath("rive/w/door.riv.json"));
    assert.ok(isWrappedPath("rive/w/door.riv.json?v=2"));
    assert.equal(isWrappedPath("https://example.com/door.riv"), false);
  }],
  ["uploads are only allowed inside rive/<world-id>/", () => {
    assert.equal(uploadRoot("w1"), "rive/w1");
    for (const ok of ["rive/w1", "rive/w1/", "rive/w1/spike", "rive/w1/a/b"]) assert.ok(isAllowedUploadDir(ok, "w1"), ok);
    for (const bad of ["rive", "rive/", "rive/w2", "rive/w1x", "rive/w1/../w2", "worlds/w1", "modules/foundry-rive", "", null]) {
      assert.equal(isAllowedUploadDir(bad, "w1"), false, String(bad));
    }
  }],
  ["uploadRiv refuses a folder outside the upload root before touching anything", async () => {
    const calls = [];
    globalThis.FilePicker = { createDirectory: async (...a) => calls.push(["dir", ...a]), upload: async (...a) => calls.push(["upload", ...a]) };
    const file = new File([new Uint8Array([1, 2, 3])], "x.riv");
    await assert.rejects(uploadRiv(file, { dir: "worlds/test-world" }));
    await assert.rejects(uploadRiv(file, { dir: "rive/test-world", source: "s3" }));
    assert.equal(calls.length, 0);
  }]
];
