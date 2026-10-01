#!/usr/bin/env node
import { SkillLab } from './lib/lab-core.mjs';
import { runCommand } from './lib/commands.mjs';

const argv = process.argv.slice(2);
const yes = argv.at(-1) === '--yes';
if (yes) argv.pop();
try {
  const labs = new SkillLab();
  const result = await runCommand(labs, process.cwd(), argv, {
    output: text => console.log(text),
    confirm: async () => {
      if (!yes) throw new Error('Review with diff first, then repeat promote with --yes to approve.');
      return true;
    },
  });
  if (result && result.activate) {
    const lab = await labs.load(process.cwd(), result.activate);
    console.log(`\nTo activate in an existing Pi session: /skill-lab use ${result.activate}\nOr start Pi in the same project:\n${labs.launch(lab)}`);
  } else if (result && result.activate === null) {
    console.log('Use /skill-lab off in your running Pi session. This CLI does not change its state.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
