import assert from "./assert.mjs";
import { socket, USERS } from "./setup.mjs";
import * as sync from "../scripts/sync.mjs";

const CHANNEL = "module.foundry-rive";
sync.registerSocket();

const set = (target, name, value, clock, senderId) =>
  socket.receive(CHANNEL, { type: "set", target, kind: "property", name, value, clock, senderId });

export const tests = [
  ["concurrent GM edits converge whatever order they arrive in", () => {
    // Same clock = true concurrency: the higher user id wins on every client.
    set("A", "n", "10", 5, USERS.gm.id);
    set("A", "n", "90", 5, USERS.otherGm.id);
    set("B", "n", "90", 5, USERS.otherGm.id);
    set("B", "n", "10", 5, USERS.gm.id);
    assert.equal(sync.knownValues("A").property.get("n"), "90");
    assert.equal(sync.knownValues("B").property.get("n"), "90");
  }],
  ["a newer clock wins, an older one is ignored", () => {
    set("C", "n", "1", 7, USERS.gm.id);
    set("C", "n", "2", 9, USERS.gm.id);
    set("C", "n", "stale", 8, USERS.otherGm.id);
    assert.equal(sync.knownValues("C").property.get("n"), "2");
  }],
  ["messages claiming a player sender are ignored", () => {
    set("D", "n", "from player", 100, USERS.player.id);
    assert.equal(sync.knownValues("D").property.has("n"), false);
  }],
  ["malformed versions are ignored", () => {
    socket.receive(CHANNEL, { type: "set", target: "E", kind: "property", name: "n", value: "x", clock: "soon", senderId: USERS.gm.id });
    socket.receive(CHANNEL, { type: "set", target: "E", kind: "elsewhere", name: "n", value: "x", clock: 1, senderId: USERS.gm.id });
    assert.equal(sync.knownValues("E").property.size, 0);
  }],
  ["state answers are only taken from GMs and only when addressed to us", () => {
    const values = { property: [["n", { value: "late", clock: 50, by: USERS.gm.id }]] };
    socket.receive(CHANNEL, { type: "state", target: "F", to: game.user.id, values, senderId: USERS.player.id });
    socket.receive(CHANNEL, { type: "state", target: "F", to: "someone-else", values, senderId: USERS.gm.id });
    assert.equal(sync.knownValues("F").property.has("n"), false);
    socket.receive(CHANNEL, { type: "state", target: "F", to: game.user.id, values, senderId: USERS.gm.id });
    assert.equal(sync.knownValues("F").property.get("n"), "late");
  }],
  ["live sync never writes documents (no update/create/delete in sync.mjs)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../scripts/sync.mjs", import.meta.url), "utf8");
    assert.equal(/\.(update|create|delete)\s*\(\s*\{|settings\.set\s*\(/.test(source), false);
  }]
];
