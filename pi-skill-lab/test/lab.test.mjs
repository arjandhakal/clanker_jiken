import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillLab, candidateInstructions, environmentFor, git, pathsFor, selectComponents, shellPrefix, shellQuote, splitArgs } from '../lib/lab-core.mjs';
import { runCommand } from '../lib/commands.mjs';
const exec = promisify(execFile);

async function fixture(t) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'skill-lab-test-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "project with 'quotes'");
  await mkdir(path.join(source, 'src'), { recursive: true });
  await git(source, ['init', '--initial-branch=main']);
  await git(source, ['config', 'user.name', 'Lab Test']);
  await git(source, ['config', 'user.email', 'lab@example.test']);
  await writeFile(path.join(source, 'src/app.txt'), 'original\n');
  await writeFile(path.join(source, '.gitignore'), '.pi/\ntools/\nartifacts/\n.env\n');
  await git(source, ['add', '.']);
  await git(source, ['commit', '-m', 'Baseline']);
  const base = await git(source, ['rev-parse', 'HEAD']);
  const labs = new SkillLab({ home: path.join(directory, 'external experiments') });
  return { source, labs, base, directory };
}

async function write(root, relative, content) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), content);
}

async function sourceState(source) {
  return {
    head: await git(source, ['rev-parse', 'HEAD']),
    branch: await git(source, ['symbolic-ref', 'HEAD']),
    status: await git(source, ['status', '--porcelain']),
    index: await readFile(path.join(source, '.git/index')),
    app: await readFile(path.join(source, 'src/app.txt')),
  };
}

test('creates only external assets, without copying the repo or changing project files/index', async t => {
  const { source, labs } = await fixture(t);
  await write(source, 'src/app.txt', 'staged\n');
  await git(source, ['add', 'src/app.txt']);
  await write(source, 'src/app.txt', 'unstaged\n');
  await write(source, '.env', 'secret');
  const before = await sourceState(source);
  const lab = await labs.create(path.join(source, 'src'), 'formatter');
  const paths = pathsFor(lab);
  assert.equal(lab.source, source);
  assert.match(await readFile(path.join(paths.skill, 'SKILL.md'), 'utf8'), /name: formatter/);
  await assert.rejects(lstat(path.join(lab.directory, 'workspace')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(lab.directory, '.git')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(source, '.pi')), { code: 'ENOENT' });
  assert.deepEqual(await sourceState(source), before);
  assert.equal((await labs.list(path.join(source, 'src')))[0].name, 'formatter');
  assert.match(labs.launch(lab), /^cd /);
  assert.match(labs.launch(lab), /--skill-lab 'formatter'/);
  assert.doesNotMatch(labs.launch(lab), /workspace|no-skills|no-extensions/);
  assert.match(candidateInstructions(lab), /REAL project/);
  await assert.rejects(labs.create(source, 'formatter'), { code: 'EEXIST' });
});

test('external CLI tools run in the REAL repo, with artifacts stored externally', async t => {
  const { source, labs } = await fixture(t);
  const lab = await labs.create(source, 'cli-test');
  const paths = pathsFor(lab);
  await write(paths.tools, 'bin/project-cli', '#!/bin/sh\ncat src/app.txt > "$PI_SKILL_LAB_ARTIFACTS/report.txt"\nprintf "real project edit\\n" > src/app.txt\npwd\n');
  await chmod(path.join(paths.tools, 'bin/project-cli'), 0o755);
  const originalPath = process.env.PATH;
  const { stdout } = await exec('/bin/sh', ['-c', `${shellPrefix(lab)}project-cli`], { cwd: source });
  assert.equal(stdout.trim(), source);
  assert.equal(await readFile(path.join(paths.artifacts, 'report.txt'), 'utf8'), 'original\n');
  assert.equal(await readFile(path.join(source, 'src/app.txt'), 'utf8'), 'real project edit\n');
  await assert.rejects(lstat(path.join(source, 'artifacts')), { code: 'ENOENT' });
  assert.equal(process.env.PATH, originalPath);
  const env = environmentFor(lab, { PATH: '/usr/bin' });
  assert.equal(env.PATH, `${path.join(paths.tools, 'bin')}${path.delimiter}/usr/bin`);
  assert.equal(env.PI_SKILL_LAB_PROJECT, source);
});

test('default promotion commits skill/tools only to a new branch, preserving the real checkout/index', async t => {
  const { source, labs, base } = await fixture(t);
  const lab = await labs.create(source, 'formatter');
  const paths = pathsFor(lab);
  await write(paths.skill, 'SKILL.md', '---\nname: formatter\ndescription: Format project fixtures.\n---\n# Format\n');
  await write(paths.tools, 'bin/run.sh', '#!/bin/sh\necho okay\n');
  await chmod(path.join(paths.tools, 'bin/run.sh'), 0o755);
  await write(paths.tools, 'data.bin', Buffer.from([0, 1, 255, 0]));
  await write(paths.artifacts, 'report.txt', 'do not promote by default');
  await write(source, 'src/app.txt', 'my staged work\n');
  await git(source, ['add', 'src/app.txt']);
  await write(source, 'src/app.txt', 'my unstaged work\n');
  const before = await sourceState(source);
  const review = await labs.review(source, 'formatter');
  assert.equal(review.changed, true);
  assert.match(await readFile(review.reviewFile, 'utf8'), /Format project fixtures/);
  assert.doesNotMatch(review.summary, /src\/app|report.txt/);
  const result = await labs.promote(source, 'formatter', 'skills/formatter', [], review);
  assert.deepEqual(await sourceState(source), before);
  assert.equal(await git(source, ['rev-parse', 'skills/formatter^']), base);
  assert.equal(await git(source, ['rev-parse', 'skills/formatter']), result.commit);
  assert.equal(await git(source, ['show', 'skills/formatter:src/app.txt']), 'original');
  assert.equal(await git(source, ['show', 'skills/formatter:tools/formatter/bin/run.sh']), '#!/bin/sh\necho okay');
  assert.match(await git(source, ['ls-tree', 'skills/formatter', 'tools/formatter/bin/run.sh']), /^100755/);
  assert.equal(await git(source, ['show', '-s', '--format=%an <%ae>', result.commit]), 'Lab Test <lab@example.test>');
  assert.equal(await git(source, ['diff', '--name-only', base, result.commit]), '.pi/skills/formatter/SKILL.md\ntools/formatter/bin/run.sh\ntools/formatter/data.bin');
  await assert.rejects(readFile(path.join(source, '.git/FETCH_HEAD')), { code: 'ENOENT' });
  assert.match(await readFile(path.join(paths.skill, 'SKILL.md'), 'utf8'), /Format project fixtures/);
});

test('artifacts are opt-in and promotions use current committed HEAD rather than creation-time HEAD', async t => {
  const { source, labs } = await fixture(t);
  const lab = await labs.create(source, 'report');
  await write(pathsFor(lab).artifacts, 'result.txt', 'approved report');
  await write(source, 'src/app.txt', 'new committed project version\n');
  await git(source, ['add', 'src/app.txt']);
  await git(source, ['commit', '-m', 'Project progressed during skill trial']);
  const current = await git(source, ['rev-parse', 'HEAD']);
  const review = await labs.review(source, 'report', ['artifacts']);
  assert.deepEqual(review.components, ['artifacts']);
  await labs.promote(source, 'report', 'report-only', ['artifacts'], review);
  assert.equal(await git(source, ['rev-parse', 'report-only^']), current);
  assert.equal(await git(source, ['show', 'report-only:artifacts/report/result.txt']), 'approved report');
  assert.equal(await git(source, ['show', 'report-only:src/app.txt']), 'new committed project version');
  assert.equal(await git(source, ['ls-tree', 'report-only', '.pi/skills/report']), '');
});

test('empty tool dirs do not prevent skill promotion; selected destinations are replaced including deletions', async t => {
  const { source, labs } = await fixture(t);
  await write(source, '.pi/skills/update/SKILL.md', 'old skill');
  await write(source, '.pi/skills/update/obsolete', 'remove me');
  await git(source, ['add', '-f', '.pi/skills/update']);
  await git(source, ['commit', '-m', 'Existing skill']);
  await labs.create(source, 'update');
  const review = await labs.review(source, 'update');
  assert.match(await readFile(review.reviewFile, 'utf8'), /deleted file mode/);
  await labs.promote(source, 'update', 'updated', [], review);
  assert.equal(await git(source, ['ls-tree', 'updated', '.pi/skills/update/obsolete']), '');
  assert.equal(await git(source, ['ls-tree', 'updated', 'tools/update']), '');
});

test('refuses existing branches, project HEAD changes after review, and post-review asset changes', async t => {
  const { source, labs } = await fixture(t);
  const lab = await labs.create(source, 'checks');
  await assert.rejects(labs.promote(source, 'checks', 'main'), /already exists/);
  const review = await labs.review(source, 'checks');
  await write(pathsFor(lab).tools, 'changed', 'new');
  await assert.rejects(labs.promote(source, 'checks', 'changed', [], review), /changed after review/);
  await assert.rejects(git(source, ['rev-parse', '--verify', 'refs/heads/changed']));
  await git(source, ['commit', '--allow-empty', '-m', 'Project progressed']);
  await assert.rejects(labs.promote(source, 'checks', 'drifted', [], review), /HEAD changed/);
});

test('refuses arbitrary paths/components, symlinks, nested repos, and missing asset directories', async t => {
  const { source, labs } = await fixture(t);
  const lab = await labs.create(source, 'safe');
  const paths = pathsFor(lab);
  for (const selected of ['..', '../src', '.', '/tmp', '.git', 'unknown']) {
    await assert.rejects(labs.review(source, 'safe', [selected]), /Unknown component/);
  }
  await symlink(path.join(source, 'src/app.txt'), path.join(paths.tools, 'link'));
  await assert.rejects(labs.review(source, 'safe'), /Symlinks/);
  await rm(path.join(paths.tools, 'link'));
  await write(paths.tools, 'nested/.git/config', 'nested');
  await assert.rejects(labs.review(source, 'safe'), /Nested repositories/);
  await rm(path.join(paths.tools, 'nested'), { recursive: true });
  await rm(paths.artifacts, { recursive: true });
  await assert.rejects(labs.review(source, 'safe', ['artifacts']), /directory is missing/);
  await rm(paths.tools, { recursive: true });
  await symlink(source, paths.tools);
  await assert.rejects(labs.load(source, 'safe'), /Symlinks/);
});

test('validates names and storage, including internal storage reached through a symlink', async t => {
  const { source, labs, directory } = await fixture(t);
  for (const name of ['../bad', 'Upper', 'bad--name', '', 'a'.repeat(65)]) {
    await assert.rejects(labs.create(source, name), /Use a name/);
  }
  const internal = new SkillLab({ home: path.join(source, 'scratch') });
  await assert.rejects(internal.create(source, 'test'), /outside the project/);
  await assert.rejects(lstat(path.join(source, 'scratch')), { code: 'ENOENT' });
  const link = path.join(directory, 'linked-home');
  await symlink(source, link);
  await assert.rejects(new SkillLab({ home: path.join(link, 'new', 'nested') }).create(source, 'test'), /outside the project/);
  assert.deepEqual(await labs.list(source), []);
});

test('human commands return session activation preferences and cancellation creates no branch', async t => {
  const { source, labs } = await fixture(t);
  const output = [];
  const options = { output: text => output.push(text) };
  const activation = await runCommand(labs, source, ['new', 'commands'], options);
  assert.deepEqual(activation, { activate: 'commands', source });
  assert.deepEqual(await runCommand(labs, source, ['off'], options), { activate: null });
  await runCommand(labs, source, ['promote', 'commands', 'candidate'], { ...options, confirm: async () => false });
  assert.equal(output.at(-1), 'Promotion cancelled.');
  await assert.rejects(git(source, ['rev-parse', '--verify', 'candidate']));
  await runCommand(labs, source, ['promote', 'commands', 'candidate'], { ...options, confirm: async () => true });
  assert.match(output.at(-1), /Created branch candidate/);
  await assert.rejects(runCommand(labs, source, ['open', 'commands', 'extra'], options), /Usage/);
});

test('rename moves external assets and preserves legacy primary skill identity, contents, and project state', async t => {
  const { source, labs } = await fixture(t);
  const original = await labs.create(source, 'original');
  const originalPaths = pathsFor(original);
  const skill = await readFile(path.join(originalPaths.skill, 'SKILL.md'));
  await write(original.directory, 'skills/teach/SKILL.md', '---\nname: teach\ndescription: Companion.\n---\n');
  await write(originalPaths.tools, 'bin/helper', '#!/bin/sh\necho helper\n');
  await chmod(path.join(originalPaths.tools, 'bin/helper'), 0o755);
  await write(originalPaths.artifacts, 'report.bin', Buffer.from([0, 255, 1]));
  await write(original.directory, 'review.diff', 'existing review');
  // Existing on-disk manifests have no primarySkill field; they must still rename safely.
  const manifestPath = path.join(original.directory, 'lab.json');
  const legacy = JSON.parse(await readFile(manifestPath, 'utf8'));
  delete legacy.primarySkill;
  legacy.customMetadata = { preserve: true };
  await writeFile(manifestPath, JSON.stringify(legacy));
  await write(source, 'src/app.txt', 'pending project edit\n');
  const before = await sourceState(source);
  const renamed = await labs.rename(source, 'original', 'new-label');
  assert.equal(renamed.name, 'new-label');
  assert.equal(renamed.primarySkill, 'original');
  assert.equal(renamed.createdAt, original.createdAt);
  assert.deepEqual(renamed.customMetadata, { preserve: true });
  const paths = pathsFor(renamed);
  assert.equal(path.basename(paths.skill), 'original');
  assert.deepEqual(await readFile(path.join(paths.skill, 'SKILL.md')), skill);
  assert.equal(await readFile(path.join(renamed.directory, 'skills/teach/SKILL.md'), 'utf8'), '---\nname: teach\ndescription: Companion.\n---\n');
  assert.deepEqual(await readFile(path.join(paths.artifacts, 'report.bin')), Buffer.from([0, 255, 1]));
  assert.equal((await lstat(path.join(paths.tools, 'bin/helper'))).mode & 0o777, 0o755);
  assert.equal(await readFile(path.join(renamed.directory, 'review.diff'), 'utf8'), 'existing review');
  assert.equal(JSON.parse(await readFile(path.join(renamed.directory, 'lab.json'), 'utf8')).primarySkill, 'original');
  await assert.rejects(labs.load(source, 'original'), { code: 'ENOENT' });
  assert.deepEqual((await labs.list(source)).map(lab => lab.name), ['new-label']);
  assert.deepEqual(await sourceState(source), before);
  const twice = await labs.rename(source, 'new-label', 'final-label');
  assert.equal(twice.primarySkill, 'original');
  assert.match(environmentFor(twice).PI_SKILL_LAB_SKILL, /final-label\/skills\/original$/);
  assert.match(labs.launch(twice), /--skill-lab 'final-label'/);
  const review = await labs.review(source, 'final-label');
  await labs.promote(source, 'final-label', 'renamed-assets', [], review);
  assert.match(await git(source, ['show', 'renamed-assets:.pi/skills/original/SKILL.md']), /name: original/);
  assert.equal(await git(source, ['show', 'renamed-assets:tools/final-label/bin/helper']), '#!/bin/sh\necho helper');
  assert.equal(await git(source, ['ls-tree', 'renamed-assets', '.pi/skills/final-label']), '');
  assert.deepEqual(await sourceState(source), before);
});

test('rename refuses invalid names, occupied targets, missing labs, and same-name requests without changes', async t => {
  const { source, labs } = await fixture(t);
  const original = await labs.create(source, 'original');
  await labs.create(source, 'occupied');
  const before = await readFile(path.join(original.directory, 'lab.json'));
  for (const name of ['../escape', 'Upper', 'double--hyphen', 'a'.repeat(65)]) {
    await assert.rejects(labs.rename(source, 'original', name), /Use a name/);
  }
  await assert.rejects(labs.rename(source, 'original', 'occupied'), /already exists/);
  await assert.rejects(labs.rename(source, 'original', 'original'), /must differ/);
  await assert.rejects(labs.rename(source, 'missing', 'valid'), { code: 'ENOENT' });
  const project = path.dirname(original.directory);
  await mkdir(path.join(project, 'empty-target'));
  await assert.rejects(labs.rename(source, 'original', 'empty-target'), /already exists/);
  await symlink(original.directory, path.join(project, 'linked-target'));
  await assert.rejects(labs.rename(source, 'original', 'linked-target'), /already exists/);
  assert.deepEqual(await readFile(path.join(original.directory, 'lab.json')), before);
  await assert.rejects(lstat(path.join(project, '.mutation-lock')), { code: 'ENOENT' });
  assert.equal((await labs.load(source, 'original')).name, 'original');
});

test('create and rename share a cross-instance mutation lock so targets cannot race', async t => {
  const { source, labs } = await fixture(t);
  await labs.create(source, 'original');
  const second = new SkillLab({ home: labs.home });
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const held = labs.mutateProject(source, async () => { entered(); await gate; });
  await started;
  try {
    await assert.rejects(second.rename(source, 'original', 'new-name'), /in progress/);
    await assert.rejects(second.create(source, 'new-name'), /in progress/);
    assert.equal((await second.load(source, 'original')).name, 'original');
  } finally {
    release();
    await held;
  }
  assert.equal((await second.rename(source, 'original', 'new-name')).name, 'new-name');
});

test('rename command reports a rename, not activation, and retains original skill commands', async t => {
  const { source, labs } = await fixture(t);
  const output = [];
  const options = { output: text => output.push(text) };
  await labs.create(source, 'original');
  const result = await runCommand(labs, source, ['rename', 'original', 'new-label'], options);
  assert.deepEqual(result, { renamedFrom: 'original', renamedTo: 'new-label', source });
  assert.match(output.at(-1), /Skill names and contents are unchanged/);
  await runCommand(labs, source, ['use', 'new-label'], options);
  assert.match(output.at(-1), /\/skill:original/);
  assert.doesNotMatch(output.at(-1), /\/skill:new-label/);
  for (const args of [['rename'], ['rename', 'new-label'], ['rename', 'new-label', 'next', 'extra']]) {
    await assert.rejects(runCommand(labs, source, args, options), /Usage: rename/);
  }
  // The standalone CLI exposes the same behavior without touching session selection.
  const { stdout } = await exec(process.execPath, [fileURLToPath(new URL('../cli.mjs', import.meta.url)), 'rename', 'new-label', 'cli-label'], {
    cwd: source, env: { ...process.env, PI_SKILL_LAB_HOME: labs.home },
  });
  assert.match(stdout, /Renamed lab new-label → cli-label/);
  assert.equal((await labs.load(source, 'cli-label')).primarySkill, 'original');
});

test('argument parsing, component selection, and POSIX shell quoting', () => {
  assert.deepEqual(splitArgs('promote demo branch "a b" \'single quoted\' escaped\\ space'), ['promote', 'demo', 'branch', 'a b', 'single quoted', 'escaped space']);
  assert.deepEqual(splitArgs(''), []);
  assert.throws(() => splitArgs("new 'unfinished"), /Unfinished/);
  assert.equal(shellQuote("it's here"), "'it'\\''s here'");
  assert.deepEqual(selectComponents(['all']), ['skill', 'tools', 'artifacts']);
  assert.deepEqual(selectComponents(['skill', 'skill']), ['skill']);
});
