import { realpathSync } from "node:fs";
import { basename } from "node:path";

export function resolvePiInvocation(): { command: string; baseArgs: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript) {
    try {
      const realEntry = realpathSync(currentScript);
      if (/\.(?:mjs|cjs|js)$/i.test(realEntry)) {
        return { command: process.execPath, baseArgs: [realEntry] };
      }
    } catch {
      // Fall back to the executable name below.
    }
  }
  const executable = basename(process.execPath).toLowerCase();
  return /^(node|bun)(\.exe)?$/.test(executable)
    ? { command: "pi", baseArgs: [] }
    : { command: process.execPath, baseArgs: [] };
}

export function buildChildArgv(options: {
  childExtension: string;
  childSessionFile: string;
  model: string;
  thinking?: string;
  sessionName: string;
  prompt?: string;
}): { command: string; args: string[] } {
  const invocation = resolvePiInvocation();
  const args = [
    ...invocation.baseArgs,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-approve",
    "--tools",
    "read,grep,find,ls,review_publish",
    "--extension",
    options.childExtension,
    "--session",
    options.childSessionFile,
    "--name",
    options.sessionName,
    "--model",
    options.model,
  ];
  if (options.thinking) args.push("--thinking", options.thinking);
  if (options.prompt) args.push(options.prompt);
  return { command: invocation.command, args };
}
