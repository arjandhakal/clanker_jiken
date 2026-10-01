import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SkillLab, git, pathsFor, skillsRootFor } from '../lib/lab-core.mjs';

// Run with Pi's peer dependency installed, or PI_SDK_PATH=/path/to/pi/dist/index.js.
// No model calls, network access, auth files, global installs, or persistent sessions.
test('Pi integration: whole skill tree loads, manual-only flags persist, real cwd, shell/guard, off unloads', async t => {
  let sdk;
  const previousOffline = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = '1';
  try {
    sdk = await import(process.env.PI_SDK_PATH ? pathToFileURL(path.resolve(process.env.PI_SDK_PATH)).href : '@earendil-works/pi-coding-agent');
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && !process.env.PI_SDK_PATH) {
      t.skip('Install the Pi peer dependency or set PI_SDK_PATH for runtime integration checks.');
      if (previousOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previousOffline;
      return;
    }
    throw error;
  }
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = sdk;
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'skill-lab-pi-test-')));
  const cwd = path.join(root, 'project');
  await mkdir(cwd);
  await git(cwd, ['init', '--initial-branch=main']);
  const previousHome = process.env.PI_SKILL_LAB_HOME;
  process.env.PI_SKILL_LAB_HOME = path.join(root, 'external');
  const errors = [];
  let session;
  try {
    const loader = new DefaultResourceLoader({
      cwd, agentDir: path.join(root, 'agent'), settingsManager: SettingsManager.inMemory(),
      noExtensions: true, noSkills: true,
      additionalExtensionPaths: [fileURLToPath(new URL('../extensions/index.ts', import.meta.url))],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    ({ session } = await createAgentSession({
      cwd, agentDir: path.join(root, 'agent'), resourceLoader: loader,
      settingsManager: SettingsManager.inMemory(), sessionManager: SessionManager.inMemory(cwd),
    }));
    await session.bindExtensions({
      mode: 'print', onError: error => errors.push(error),
      commandContextActions: { waitForIdle: () => session.waitForIdle(), reload: () => session.reload() },
    });
    await new SkillLab().create(cwd, 'picker-target');
    let pickerRequest;
    const baseUi = session.extensionRunner.getUIContext();
    session.extensionRunner.setUIContext({
      ...baseUi,
      select: async (title, options) => {
        pickerRequest = { title, options };
        return options[0];
      },
    }, 'tui');
    await session.prompt('/skill-lab');
    assert.deepEqual(pickerRequest, {
      title: 'Select a skill lab to activate',
      options: ['picker-target  •  /skill:picker-target'],
    });
    assert.deepEqual(loader.getSkills().skills.map(skill => skill.name), ['picker-target']);
    await session.prompt('/skill-lab new smoke-candidate');
    assert.deepEqual(errors, []);
    assert.equal(loader.getSkills().skills.find(skill => skill.name === 'smoke-candidate')?.name, 'smoke-candidate');
    const lab = await new SkillLab().load(cwd, 'smoke-candidate');
    for (const name of ['how', 'why', 'teach']) {
      const directory = path.join(skillsRootFor(lab), name);
      await mkdir(directory);
      await writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Test ${name} companion skill.\ndisable-model-invocation: true\n---\n\n# ${name}\n`);
    }
    // A SKILL.md in generated artifacts must not leak into discovery.
    const fixtureDirectory = path.join(pathsFor(lab).artifacts, 'fixture');
    await mkdir(fixtureDirectory);
    await writeFile(path.join(fixtureDirectory, 'SKILL.md'), '---\nname: fixture\ndescription: Not a real candidate.\n---\n');
    await session.reload();
    const skills = loader.getSkills().skills;
    assert.deepEqual(skills.map(skill => skill.name).sort(), ['how', 'smoke-candidate', 'teach', 'why']);
    for (const name of ['how', 'why', 'teach']) {
      assert.equal(skills.find(skill => skill.name === name)?.disableModelInvocation, true);
    }
    assert.equal(session.extensionRunner.createContext().cwd, cwd);
    const bash = { type: 'tool_call', toolName: 'bash', toolCallId: 'bash', input: { command: 'pwd' } };
    await session.extensionRunner.emitToolCall(bash);
    assert.match(bash.input.command, /export PI_SKILL_LAB_ARTIFACTS=/);
    const blocked = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolName: 'write', toolCallId: 'candidate', input: { path: 'tools/smoke-candidate/cli.py', content: 'x' } });
    assert.equal(blocked?.block, true);
    const allowed = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolName: 'write', toolCallId: 'source', input: { path: 'src/app.ts', content: 'x' } });
    assert.equal(allowed?.block, undefined);
    await session.prompt('/skill-lab off');
    assert.deepEqual(loader.getSkills().skills, []);
    const ordinary = { type: 'tool_call', toolName: 'bash', toolCallId: 'off', input: { command: 'pwd' } };
    await session.extensionRunner.emitToolCall(ordinary);
    assert.equal(ordinary.input.command, 'pwd');
    await session.prompt('/skill-lab use smoke-candidate');
    assert.deepEqual(loader.getSkills().skills.map(skill => skill.name).sort(), ['how', 'smoke-candidate', 'teach', 'why']);
    await session.prompt('/skill-lab rename smoke-candidate renamed-lab');
    assert.deepEqual(loader.getSkills().skills.map(skill => skill.name).sort(), ['how', 'smoke-candidate', 'teach', 'why']);
    const renamed = await new SkillLab().load(cwd, 'renamed-lab');
    assert.equal(renamed.primarySkill, 'smoke-candidate');
    assert.equal(loader.getSkills().skills.find(skill => skill.name === 'smoke-candidate')?.filePath, path.join(pathsFor(renamed).skill, 'SKILL.md'));
    const afterRename = { type: 'tool_call', toolName: 'bash', toolCallId: 'renamed', input: { command: 'pwd' } };
    await session.extensionRunner.emitToolCall(afterRename);
    assert.match(afterRename.input.command, /renamed-lab\/artifacts/);
    assert.doesNotMatch(afterRename.input.command, /smoke-candidate\/artifacts/);
    const primaryGuard = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolName: 'edit', toolCallId: 'primary', input: { path: '.pi/skills/smoke-candidate/SKILL.md', oldText: 'x', newText: 'y' } });
    assert.equal(primaryGuard?.block, true);
    const selections = () => session.sessionManager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === 'skill-lab-selection');
    assert.equal(selections().at(-1)?.data.name, 'renamed-lab');
    await session.reload();
    assert.equal(loader.getSkills().skills.find(skill => skill.name === 'smoke-candidate')?.filePath, path.join(pathsFor(renamed).skill, 'SKILL.md'));
    // Renaming a different, inactive lab must not switch this session's selection.
    await session.prompt('/skill-lab new other-lab');
    await session.prompt('/skill-lab rename renamed-lab archived-lab');
    assert.equal(selections().at(-1)?.data.name, 'other-lab');
    assert.deepEqual(loader.getSkills().skills.map(skill => skill.name), ['other-lab']);
    assert.equal((await new SkillLab().load(cwd, 'archived-lab')).primarySkill, 'smoke-candidate');
    assert.deepEqual(errors, []);
  } finally {
    session?.dispose();
    if (previousHome === undefined) delete process.env.PI_SKILL_LAB_HOME; else process.env.PI_SKILL_LAB_HOME = previousHome;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previousOffline;
    await rm(root, { recursive: true, force: true });
  }
});
