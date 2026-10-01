import path from 'node:path';
import { help, mappings, pathsFor, shellPrefix, shellQuote } from './lab-core.mjs';

function skillsRootForLab(lab) {
  return path.join(lab.directory, 'skills');
}

function describe(lab) {
  const paths = pathsFor(lab);
  return `Experiment: ${lab.name}\nReal project: ${lab.source}\n\nPrimary skill: ${paths.skill}/SKILL.md\nSkills discovery root: ${skillsRootForLab(lab)} (includes companion skills; /reload after adding or editing metadata)\nCLI tools: ${paths.tools} (bin/ is added to agent bash PATH)\nArtifacts: ${paths.artifacts}\n\nYour project cwd and normal file tools are unchanged.\n\nTo use these paths in an ordinary terminal:\n${shellPrefix(lab)}`;
}

export async function runCommand(labs, cwd, args, { output, confirm = async () => false }) {
  const [command = 'help', name, branch, ...extra] = args;
  if (command === 'help') { output(help); return; }
  if (command === 'off') {
    if (args.length !== 1) throw new Error('Usage: off');
    output('Candidate deactivated. External files are retained.');
    return { activate: null };
  }
  if (command === 'list') {
    if (args.length !== 1) throw new Error('Usage: list');
    const items = await labs.list(cwd);
    output(items.length ? items.map(lab => `${lab.name}\n  ${lab.directory}`).join('\n') : 'No experiments for this project. Use new <name>.');
    return;
  }
  if (command === 'rename') {
    if (args.length !== 3) throw new Error('Usage: rename <old-name> <new-name>');
    const lab = await labs.rename(cwd, name, branch);
    output(`Renamed lab ${name} → ${lab.name}. Skill names and contents are unchanged.\n${describe(lab)}\n\nOther Pi sessions using the old name must select: /skill-lab use ${lab.name}\nHardcoded absolute paths are not rewritten; use the updated shell variables.`);
    return { renamedFrom: name, renamedTo: lab.name, source: lab.source };
  }
  if (!name) throw new Error(`Usage: ${command} <name>${command === 'promote' ? ' <branch> [components...]' : ''}`);
  if (['new', 'use', 'status', 'open'].includes(command)) {
    if (args.length !== 2) throw new Error(`Usage: ${command} <name>`);
    const lab = command === 'new' ? await labs.create(cwd, name) : await labs.load(cwd, name);
    output(describe(lab));
    if (command === 'open') output(`Start Pi in the SAME project with this candidate:\n${labs.launch(lab)}`);
    if (command === 'new' || command === 'use') {
      output(`Use /skill:${lab.primarySkill} <task> after resources reload. Ordinary project edits happen in the real repo.`);
      return { activate: name, source: lab.source };
    }
    return;
  }
  if (command === 'diff') {
    const review = await labs.review(cwd, name, args.slice(2));
    output(`Selected assets: ${review.components.join(', ')}\n${review.summary || 'No selected changes.'}\n\nFull diff: ${review.reviewFile}`);
    return;
  }
  if (command === 'promote') {
    if (!branch) throw new Error('Usage: promote <name> <branch> [components...]');
    const lab = await labs.load(cwd, name);
    await labs.validateBranch(lab, branch);
    const review = await labs.review(cwd, name, extra);
    if (!review.changed) throw new Error('No selected changes to promote.');
    const destinations = review.components.map(component => mappings(name, lab.primarySkill)[component].to).join(', ');
    const description = `Project: ${lab.source}\nNew branch: ${branch}\nDestination paths: ${destinations}\nBase HEAD: ${review.base.slice(0, 12)}\n\n${review.summary}\n\nFull diff: ${review.reviewFile}\nOnly selected external assets will be committed. Existing destination directories are REPLACED by the external versions. Artifacts are excluded unless explicitly selected.\nYour current checkout and index stay unchanged; ordinary uncommitted project edits are NOT included.`;
    output(description);
    if (!await confirm('Promote this skill lab?', description)) { output('Promotion cancelled.'); return; }
    const result = await labs.promote(cwd, name, branch, review.components, review);
    output(`Created branch ${result.branch} (${result.commit.slice(0, 12)}) with selected assets committed.\nYour project checkout and index are unchanged; pending project edits were NOT committed.\nWhen ready: git switch ${shellQuote(result.branch)}\nExternal originals are retained. Use off to stop loading the candidate before testing the promoted skill.`);
    return;
  }
  throw new Error(`Unknown command: ${command}.\n${help}`);
}
