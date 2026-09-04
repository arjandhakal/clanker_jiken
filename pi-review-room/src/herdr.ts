export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (command: string, args: string[]) => Promise<ExecResult>;

export interface HerdrLaunch {
  agentName: string;
  cwd: string;
  env: Record<string, string>;
  command: string;
  args: string[];
  focus?: boolean;
}

function parseStartedPane(output: string): string | undefined {
  try {
    const parsed = JSON.parse(output) as { result?: { agent?: { pane_id?: string }; pane_id?: string } };
    return parsed.result?.agent?.pane_id ?? parsed.result?.pane_id;
  } catch {
    return undefined;
  }
}

export async function launchHerdrAgent(exec: Exec, launch: HerdrLaunch): Promise<string> {
  const args = ["agent", "start", launch.agentName, "--cwd", launch.cwd, "--split", "right"];
  args.push(launch.focus === false ? "--no-focus" : "--focus");
  for (const [key, value] of Object.entries(launch.env)) args.push("--env", `${key}=${value}`);
  args.push("--", launch.command, ...launch.args);
  const result = await exec("herdr", args);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `herdr exited ${result.code}`);
  }
  const paneId = parseStartedPane(result.stdout);
  if (!paneId) throw new Error("Herdr started the reviewer but did not return its pane ID");
  return paneId;
}

export async function focusHerdrAgent(exec: Exec, target: string): Promise<void> {
  const result = await exec("herdr", ["agent", "focus", target]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `Could not focus ${target}`);
}

export async function closeHerdrPane(exec: Exec, target: string): Promise<void> {
  const result = await exec("herdr", ["pane", "close", target]);
  if (result.code !== 0) {
    // Agent targets are accepted by agent commands, but pane close needs a pane id on older Herdr.
    const list = await exec("herdr", ["agent", "list"]);
    const pane = findAgentPane(list.stdout, target);
    if (!pane) throw new Error(result.stderr.trim() || `Could not resolve pane for ${target}`);
    const retry = await exec("herdr", ["pane", "close", pane]);
    if (retry.code !== 0) throw new Error(retry.stderr.trim() || `Could not close ${target}`);
  }
}

export function findAgentPane(output: string, target: string): string | undefined {
  try {
    const parsed = JSON.parse(output) as any;
    const agents = parsed?.result?.agents;
    if (!Array.isArray(agents)) return undefined;
    const match = agents.find((agent: any) =>
      agent?.agent === target || agent?.name === target || agent?.pane_id === target || agent?.terminal_id === target
    );
    return typeof match?.pane_id === "string" ? match.pane_id : undefined;
  } catch {
    return undefined;
  }
}
