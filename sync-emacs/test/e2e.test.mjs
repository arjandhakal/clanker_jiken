import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Bridge } from "../extensions/bridge.ts";

const emacs = process.env.EMACS ?? "emacs";
const available = spawnSync(emacs, ["--version"]).status === 0;

test("real Emacs discovers two sockets, routes prompts/buffers, aborts and reconnects", { skip: !available, timeout: 15000 }, async () => {
  const directory = mkdtempSync("/tmp/se-e2e-");
  const calls = [], bridges = [];
  try {
    for (const name of ["Alpha", "Beta"]) {
      const rows = new Map([["history", { id: "history", role: "assistant", text: `${name} history` }]]);
      const bridge = new Bridge({
        directory,
        info: () => ({ sessionId: name, name, cwd: `/projects/${name}`, busy: false }),
        rows: () => rows.values(),
        prompt: (text, delivery) => {
          calls.push({ name, text, delivery });
          const row = { id: `prompt:${calls.length}`, role: "user", text };
          rows.set(row.id, row);
          bridge.broadcast({ type: "upsert", row });
        },
        abort: () => {
          calls.push({ name, abort: true });
          bridge.broadcast({ type: "notice", text: "abort received" });
        },
      });
      bridges.push(bridge);
      await bridge.start();
    }
    const { stdout } = await promisify(execFile)(emacs, [
      "-Q", "--batch", "-L", fileURLToPath(new URL("../emacs", import.meta.url)),
      "-l", fileURLToPath(new URL("./e2e-client.el", import.meta.url)),
    ], { env: { ...process.env, SYNC_EMACS_DIR: directory }, timeout: 12000 });
    assert.match(stdout, /integration passed/);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], { name: "Alpha", text: "Hello 日本語 🌸\nfrom Emacs", delivery: "followUp" });
    assert.equal(calls[1].name, "Beta");
    assert.match(calls[1].text, /Buffer: \/project\/unsaved.txt/);
    assert.match(calls[1].text, /Unsaved buffer contents/);
    assert.deepEqual(calls[2], { name: "Beta", abort: true });
  } finally {
    await Promise.all(bridges.map((bridge) => bridge.stop()));
    rmSync(directory, { recursive: true, force: true });
  }
});
