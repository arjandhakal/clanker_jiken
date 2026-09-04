import { expect, it, vi } from "vitest";
import { findAgentPane, launchHerdrAgent } from "../src/herdr.js";

it("launches an argv-safe Herdr agent with explicit environment", async () => {
  const exec = vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ result: { agent: { pane_id: "w1:p2" } } }), stderr: "" }));
  await expect(launchHerdrAgent(exec, { agentName: "review-1", cwd: "/repo with space", env: { CONFIG: "/tmp/a b.json" }, command: "pi", args: ["--model", "p/m", "prompt text"] })).resolves.toBe("w1:p2");
  expect(exec).toHaveBeenCalledWith("herdr", [
    "agent", "start", "review-1", "--cwd", "/repo with space", "--split", "right", "--focus", "--env", "CONFIG=/tmp/a b.json", "--", "pi", "--model", "p/m", "prompt text",
  ]);
});

it("finds a pane by exact agent name", () => {
  const output = JSON.stringify({ result: { agents: [{ agent: "other", pane_id: "p1" }, { agent: "review-1", pane_id: "p2" }] } });
  expect(findAgentPane(output, "review-1")).toBe("p2");
  expect(findAgentPane(output, "p2")).toBe("p2");
  expect(findAgentPane("bad", "review-1")).toBeUndefined();
});
