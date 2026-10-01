import path from 'node:path';
import { homedir } from 'node:os';
import { getAgentDir, isToolCallEventType, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { SkillLab, candidateInstructions, mappings, pathsFor, shellPrefix, splitArgs } from '../lib/lab-core.mjs';
import { runCommand } from '../lib/commands.mjs';

const SELECTION = 'skill-lab-selection';
type LabChoice = { name: string; label: string };

function labChoices(items: Array<{ name: string; primarySkill: string }>, activeName?: string): LabChoice[] {
  return items.map(item => ({
    name: item.name,
    label: `${item.name}${item.name === activeName ? ' (active)' : ''}  •  /skill:${item.primarySkill}`,
  }));
}

function skillsRootForLab(lab: { directory: string }) {
  return path.join(lab.directory, 'skills');
}

export default function skillLab(pi: ExtensionAPI) {
  const labs = new SkillLab({ home: process.env.PI_SKILL_LAB_HOME || path.join(getAgentDir(), 'skill-lab') });
  let active: Awaited<ReturnType<SkillLab['load']>> | undefined;
  let busy = false;

  pi.registerFlag('skill-lab', { type: 'string', description: 'Activate an external project skill-lab experiment by name' });

  async function restore(ctx: ExtensionContext) {
    active = undefined;
    let selected: unknown = pi.getFlag('skill-lab');
    try {
      const { source } = await labs.context(ctx.cwd);
      // Selection is a session-wide UI preference, not branch-sensitive tool state.
      // A later use/off command takes precedence over the startup CLI flag.
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== 'custom' || entry.customType !== SELECTION) continue;
        const data = entry.data as { source?: string; name?: string | null };
        if (data?.source === source) selected = data.name;
      }
      if (typeof selected === 'string' && selected) active = await labs.load(ctx.cwd, selected);
    } catch (error) {
      if (selected) ctx.ui.notify(error instanceof Error ? error.message : String(error), 'warning');
    }
    ctx.ui.setStatus('skill-lab', active ? `external skill: ${active.name}` : undefined);
  }

  pi.on('session_start', async (_event, ctx) => restore(ctx));

  pi.on('resources_discover', async () => {
    if (!active) return;
    // Scan the experiment's whole skills tree, not only skills/<experiment>.
    // Companion skills (e.g. how, why, teach) are siblings of the primary skill.
    return { skillPaths: [skillsRootForLab(active)] };
  });

  pi.on('before_agent_start', async () => {
    if (!active) return;
    return { message: { customType: 'skill-lab-context', display: false, content: candidateInstructions(active) } };
  });

  pi.on('tool_call', async (event, ctx) => {
    if (!active) return;
    if (isToolCallEventType('bash', event)) {
      // Keep the real project's cwd. Export only into this shell, not process.env.
      event.input.command = shellPrefix(active) + event.input.command;
    }
    if (isToolCallEventType('write', event) || isToolCallEventType('edit', event)) {
      const raw = event.input.path;
      const file = path.resolve(ctx.cwd, raw.startsWith('~/') ? path.join(homedir(), raw.slice(2)) : raw);
      for (const [component, mapping] of Object.entries(mappings(active.name, active.primarySkill))) {
        const destination = path.join(active.source, mapping.to);
        if (file === destination || file.startsWith(destination + path.sep)) {
          return { block: true, reason: `Keep candidate ${component} outside the repo until promotion. Use ${pathsFor(active)[component]} instead. Ordinary project source edits are allowed.` };
        }
      }
    }
  });

  pi.registerCommand('skill-lab', {
    description: 'Use externally stored experimental skills and tools in the real project; promote when ready',
    getArgumentCompletions(prefix) {
      const names = ['new', 'use', 'rename', 'off', 'list', 'status', 'open', 'diff', 'promote', 'help'];
      const matches = names.filter(name => name.startsWith(prefix));
      return matches.length ? matches.map(name => ({ value: name, label: name })) : null;
    },
    handler: async (args, ctx) => {
      if (busy) { ctx.ui.notify('Another skill-lab command is running.', 'warning'); return; }
      busy = true;
      let reload = false;
      try {
        await ctx.waitForIdle();
        let commandArgs = splitArgs(args);
        const pickerAction = commandArgs.length === 0 ? 'use' : commandArgs.length === 1 && ['use', 'status', 'diff'].includes(commandArgs[0]) ? commandArgs[0] : undefined;
        if (pickerAction && ctx.hasUI) {
          const choices = labChoices(await labs.list(ctx.cwd), active?.name);
          if (!choices.length) {
            ctx.ui.notify('No skill labs for this project. Use /skill-lab new <name>.', 'info');
            return;
          }
          const titles: Record<string, string> = {
            use: 'Select a skill lab to activate',
            status: 'Select a skill lab to inspect',
            diff: 'Select a skill lab to review',
          };
          const selected = await ctx.ui.select(titles[pickerAction], choices.map(choice => choice.label));
          const choice = choices.find(item => item.label === selected);
          if (!choice) return;
          commandArgs = [pickerAction, choice.name];
        }
        const result = await runCommand(labs, ctx.cwd, commandArgs, {
          output: (content: string) => pi.sendMessage({ customType: 'skill-lab', content, display: true }),
          confirm: async (title: string, message: string) => {
            if (!ctx.hasUI) throw new Error('Promotion requires interactive confirmation. Use the standalone CLI with --yes after reviewing the diff.');
            return ctx.ui.confirm(title, message);
          },
        });
        if (result && 'activate' in result) {
          const { source } = await labs.context(ctx.cwd);
          pi.appendEntry(SELECTION, { source, name: result.activate });
          reload = true;
        } else if (result && 'renamedFrom' in result && active?.name === result.renamedFrom && active.source === result.source) {
          pi.appendEntry(SELECTION, { source: result.source, name: result.renamedTo });
          reload = true;
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        busy = false;
      }
      if (reload) {
        await ctx.reload();
        return; // Runtime replaced: do not touch old pi/ctx/state after reload.
      }
    },
  });
}
