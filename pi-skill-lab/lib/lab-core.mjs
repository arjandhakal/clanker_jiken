import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename as move, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
export const extensionPath = fileURLToPath(new URL('../extensions/index.ts', import.meta.url));
export const help = `Skill lab — work in your REAL project with externally stored candidates
  new <name>                    Create and activate an external experiment
  use <name>                    Activate a candidate in this Pi session
  rename <old-name> <new-name>   Rename a lab without renaming its skills
  off                           Stop advertising the candidate in this session
  list                          List this project's experiments
  status <name>                 Show external skill, tool, and artifact paths
  open <name>                   Print a Pi launch command (same project, no clone)
  diff <name> [components...]    Review selected external assets
  promote <name> <branch> [components...]  Commit them onto a NEW project branch

Components: skill, tools, artifacts, or all. Default: skill tools.
Project edits happen normally in your working tree. Candidate assets stay outside it.
Promotion creates a branch without switching your checkout or changing your index.
Uncommitted project edits are NOT included in the promotion commit.
This is storage separation, NOT a security sandbox.`;

export function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function splitArgs(text) {
  const result = [];
  let current = '', quote = '', escaped = false, started = false;
  for (const c of text) {
    if (escaped) { current += c; escaped = false; started = true; }
    else if (c === '\\' && quote !== "'") { escaped = true; started = true; }
    else if (quote) { if (c === quote) quote = ''; else current += c; }
    else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/\s/.test(c)) { if (started) result.push(current); current = ''; started = false; }
    else { current += c; started = true; }
  }
  if (quote || escaped) throw new Error('Unfinished quote or escape.');
  if (started) result.push(current);
  return result;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function stat(file) {
  try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

export async function git(cwd, args, overrides = {}) {
  const env = { ...process.env };
  // Never accidentally reuse another tool's index or working-tree override.
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key];
  const { stdout } = await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, maxBuffer: 16 * 1024 * 1024,
    env: { ...env, GIT_LITERAL_PATHSPECS: '1', GIT_TERMINAL_PROMPT: '0', ...overrides },
  });
  return stdout.trimEnd();
}

function validateName(name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name ?? '') || name.length > 64) {
    throw new Error('Use a name of at most 64 lowercase letters, digits, and single hyphens.');
  }
}

async function checkAncestors(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if ((await stat(current))?.isSymbolicLink()) throw new Error(`Symlinks are not supported in selected assets: ${relative}`);
  }
}

async function checkTree(file) {
  const info = await stat(file);
  if (!info) return false;
  if (info.isSymbolicLink()) throw new Error(`Symlinks are not supported in selected assets: ${file}`);
  if (info.isDirectory()) {
    let hasFiles = false;
    for (const entry of await readdir(file)) {
      if (entry.toLowerCase() === '.git') throw new Error(`Nested repositories cannot be promoted: ${file}`);
      const childHasFiles = await checkTree(path.join(file, entry));
      hasFiles = hasFiles || childHasFiles;
    }
    return hasFiles;
  }
  if (!info.isFile()) throw new Error(`Not a regular file: ${file}`);
  return true;
}

export function mappings(name, primarySkill = name) {
  validateName(name);
  validateName(primarySkill);
  return {
    skill: { from: `skills/${primarySkill}`, to: `.pi/skills/${primarySkill}` },
    tools: { from: 'tools', to: `tools/${name}` },
    artifacts: { from: 'artifacts', to: `artifacts/${name}` },
  };
}

export function selectComponents(requested = []) {
  const values = requested.length ? requested : ['skill', 'tools'];
  for (const value of values) {
    if (!['skill', 'tools', 'artifacts', 'all'].includes(value)) throw new Error(`Unknown component: ${value}. Choose skill, tools, artifacts, or all.`);
  }
  return values.includes('all') ? ['skill', 'tools', 'artifacts'] : [...new Set(values)];
}

export function skillsRootFor(lab) {
  return path.join(lab.directory, 'skills');
}

export function pathsFor(lab) {
  return Object.fromEntries(Object.entries(mappings(lab.name, lab.primarySkill)).map(([key, value]) => [key, path.join(lab.directory, value.from)]));
}

export function environmentFor(lab, env = process.env) {
  const paths = pathsFor(lab);
  return {
    PI_SKILL_LAB_ROOT: lab.directory,
    PI_SKILL_LAB_PROJECT: lab.source,
    PI_SKILL_LAB_SKILL: paths.skill,
    PI_SKILL_LAB_TOOLS: paths.tools,
    PI_SKILL_LAB_ARTIFACTS: paths.artifacts,
    PATH: `${path.join(paths.tools, 'bin')}${path.delimiter}${env.PATH || ''}`,
  };
}

// Use a shell prefix rather than process.env so parallel Pi sessions do not share state.
export function shellPrefix(lab) {
  const env = environmentFor(lab);
  delete env.PATH;
  const exports = Object.entries(env).map(([key, value]) => `export ${key}=${shellQuote(value)}`);
  exports.push(`export PATH=${shellQuote(path.join(pathsFor(lab).tools, 'bin'))}:"$PATH"`);
  return `${exports.join('\n')}\n`;
}

export function candidateInstructions(lab) {
  const paths = pathsFor(lab);
  return `You are working in the REAL project at ${lab.source}, not a clone. Normal project source edits are allowed. The active experiment is ${lab.name}. All valid skills under ${skillsRootFor(lab)} are discoverable, including companion skills beside the primary skill. Store the primary skill's SKILL.md, references, and bundled scripts under ${paths.skill}; add companion skills in their own named directories under ${skillsRootFor(lab)}. Skills with disable-model-invocation: true require explicit /skill:<name> invocation. Store candidate CLI tools under ${paths.tools} (executables in bin/); store generated reports, fixtures, and other experimental artifacts under ${paths.artifacts}. These locations are outside the repo. Agent bash calls export PI_SKILL_LAB_SKILL, PI_SKILL_LAB_TOOLS, PI_SKILL_LAB_ARTIFACTS, PI_SKILL_LAB_ROOT, and PI_SKILL_LAB_PROJECT and add the external tools/bin to PATH without changing cwd. Use these variables or explicit paths, never hardcode this machine's absolute storage path in a reusable skill. Tools must accept an output directory or use PI_SKILL_LAB_ARTIFACTS; tools which ignore that convention may still create files in the repo. Do not install candidate skills globally or copy candidate assets into the repo before the user explicitly approves promotion. Use /reload after editing skill metadata. For portable instructions, resolve bundled resources relative to the skill directory. Promotion does not include ordinary uncommitted project edits.`;
}

export class SkillLab {
  constructor({ home = process.env.PI_SKILL_LAB_HOME || path.join(process.env.PI_CODING_AGENT_DIR || path.join(homedir(), '.pi', 'agent'), 'skill-lab') } = {}) {
    this.home = path.resolve(home);
  }

  async context(cwd) {
    const source = await realpath(await git(cwd, ['rev-parse', '--show-toplevel']));
    return { source };
  }

  async projectDirectory(source) {
    // Reject internal storage BEFORE creating any candidate directories.
    let canonicalHome;
    let ancestor = this.home;
    const tail = [];
    while (!await stat(ancestor)) { tail.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
    canonicalHome = path.join(await realpath(ancestor), ...tail);
    if (inside(source, canonicalHome)) throw new Error('Skill-lab storage must be outside the project repository. Set PI_SKILL_LAB_HOME.');
    await mkdir(canonicalHome, { recursive: true, mode: 0o700 });
    canonicalHome = await realpath(canonicalHome);
    if (inside(source, canonicalHome)) throw new Error('Skill-lab storage must be outside the project repository.');
    return path.join(canonicalHome, createHash('sha256').update(source).digest('hex').slice(0, 24));
  }

  async load(cwd, name) {
    validateName(name);
    const { source } = await this.context(cwd);
    const directory = path.join(await this.projectDirectory(source), name);
    if (await realpath(directory) !== directory) throw new Error('Experiment directory must not be a symlink.');
    const manifest = JSON.parse(await readFile(path.join(directory, 'lab.json'), 'utf8'));
    if (manifest.schema !== 1 || manifest.name !== name || manifest.source !== source) throw new Error('Invalid skill-lab manifest.');
    // Older manifests used the experiment name as the primary skill name. Keep
    // that identity explicit after a lab rename; skill folders/frontmatter stay intact.
    const primarySkill = manifest.primarySkill ?? manifest.name;
    for (const selected of Object.values(mappings(name, primarySkill))) await checkAncestors(directory, selected.from);
    return { ...manifest, primarySkill, directory };
  }

  async mutateProject(source, operation) {
    const project = await this.projectDirectory(source);
    await mkdir(project, { recursive: true });
    const lock = path.join(project, '.mutation-lock');
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Another skill-lab create/rename is in progress for this project. Try again when it finishes.');
      throw error;
    }
    try {
      return await operation(project);
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }

  async create(cwd, name) {
    validateName(name);
    const { source } = await this.context(cwd);
    return this.mutateProject(source, async project => {
      const directory = path.join(project, name);
      await mkdir(directory, { mode: 0o700 }); // Never overwrite an existing experiment.
      try {
        const manifest = { schema: 1, name, primarySkill: name, source, createdAt: new Date().toISOString() };
        const lab = { ...manifest, directory };
        const paths = pathsFor(lab);
        await mkdir(paths.skill, { recursive: true });
        await mkdir(path.join(paths.tools, 'bin'), { recursive: true });
        await mkdir(paths.artifacts);
        await writeFile(path.join(paths.skill, 'SKILL.md'), `---\nname: ${name}\ndescription: Experimental ${name} workflow for this project. Use when explicitly testing this candidate skill.\n---\n\n# ${name}\n\nReplace this scaffold with project-specific instructions and success criteria.\nWork on the current project normally; keep experimental assets outside its repo.\nResolve bundled scripts and references relative to this skill directory.\nCLI tools can use PI_SKILL_LAB_TOOLS and write outputs to PI_SKILL_LAB_ARTIFACTS during testing.\nBefore promotion, make paths portable (bundled scripts or an explicit output-directory argument).\n`);
        await writeFile(path.join(directory, 'lab.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
        return lab;
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async rename(cwd, name, newName) {
    validateName(name);
    validateName(newName);
    if (name === newName) throw new Error('The new lab name must differ from the current name.');
    const { source } = await this.context(cwd);
    return this.mutateProject(source, async project => {
      const lab = await this.load(cwd, name);
      const destination = path.join(project, newName);
      if (await stat(destination)) throw new Error(`Experiment already exists: ${newName}`);
      const { directory, ...manifest } = lab;
      const updated = { ...manifest, name: newName };
      const pending = `.lab-${randomUUID()}.json`;
      let moved = false;
      try {
        await writeFile(path.join(directory, pending), `${JSON.stringify(updated, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        await move(directory, destination);
        moved = true;
        await move(path.join(destination, pending), path.join(destination, 'lab.json'));
      } catch (error) {
        if (moved) {
          try {
            await move(destination, directory);
            moved = false;
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], `Rename failed and could not be rolled back. Files are retained at ${destination}; inspect its lab.json before retrying.`);
          }
        }
        throw error;
      } finally {
        await rm(path.join(moved ? destination : directory, pending), { force: true });
      }
      return { ...updated, directory: destination };
    });
  }

  async list(cwd) {
    const { source } = await this.context(cwd);
    const directory = await this.projectDirectory(source);
    if (!await stat(directory)) return [];
    const labs = [];
    for (const name of await readdir(directory)) {
      if (await stat(path.join(directory, name, 'lab.json'))) labs.push(await this.load(cwd, name));
    }
    return labs;
  }

  launch(lab) {
    return `cd ${shellQuote(lab.source)} && pi --extension ${shellQuote(extensionPath)} --skill-lab ${shellQuote(lab.name)}`;
  }

  async assertBase(lab, base) {
    if (await git(lab.source, ['rev-parse', 'HEAD']) !== base) throw new Error('Project HEAD changed after review. Review and approve again.');
  }

  async validateBranch(lab, branch) {
    if (!branch || branch.startsWith('-')) throw new Error('Specify a new branch name.');
    await git(lab.source, ['check-ref-format', `refs/heads/${branch}`]);
    const refs = await git(lab.source, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`]);
    if (refs.split('\n').includes(`refs/heads/${branch}`)) throw new Error(`Branch already exists: ${branch}`);
  }

  // Temporary clones are ONLY an implementation detail of diff/promotion. The Pi session
  // and candidate tools always operate in the real project. Neither real index is reused.
  async snapshot(lab, requested, base, callback) {
    const components = selectComponents(requested);
    const temporary = await mkdtemp(path.join(tmpdir(), 'pi-skill-lab-review-'));
    const workspace = path.join(temporary, 'review');
    try {
      await git(lab.source, ['clone', '--no-local', '--no-hardlinks', '--no-checkout', '--', lab.source, workspace]);
      await git(workspace, ['checkout', '--detach', base]);
      const stage = [];
      for (const component of components) {
        const mapping = mappings(lab.name, lab.primarySkill)[component];
        await checkAncestors(lab.directory, mapping.from);
        await checkAncestors(workspace, mapping.to);
        const from = path.join(lab.directory, mapping.from), to = path.join(workspace, mapping.to);
        // Missing assets must never silently delete existing project assets.
        const externalInfo = await stat(from);
        if (!externalInfo) throw new Error(`External ${component} directory is missing: ${from}`);
        if (!externalInfo.isDirectory()) throw new Error(`External ${component} must be a directory: ${from}`);
        const hasFiles = await checkTree(from);
        const hadFiles = await checkTree(to);
        if (hasFiles || hadFiles) stage.push(mapping.to);
        await rm(to, { recursive: true, force: true });
        await mkdir(path.dirname(to), { recursive: true });
        await cp(from, to, { recursive: true, preserveTimestamps: true });
      }
      // Stage only selected overlays, never unrelated clean/smudge-filter effects.
      // Empty directories with no baseline files are omitted (Git cannot track them).
      if (stage.length) await git(workspace, ['add', '--force', '--all', '--', ...stage]);
      const tree = await git(workspace, ['write-tree']);
      const summary = await git(workspace, ['diff', '--cached', '--stat', '--no-ext-diff', '--no-textconv']);
      const patch = await git(workspace, ['diff', '--cached', '--no-ext-diff', '--no-textconv']);
      return await callback({ workspace, components, tree, summary, patch });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async review(cwd, name, requested = []) {
    const lab = await this.load(cwd, name);
    const base = await git(lab.source, ['rev-parse', 'HEAD']);
    return this.snapshot(lab, requested, base, async ({ workspace, components, tree, summary, patch }) => {
      const reviewFile = path.join(lab.directory, 'review.diff');
      await writeFile(reviewFile, `${patch}\n`, { mode: 0o600 });
      const baseTree = await git(workspace, ['rev-parse', `${base}^{tree}`]);
      return { lab, components, base, tree, summary, reviewFile, changed: tree !== baseTree };
    });
  }

  async promote(cwd, name, branch, requested = [], expected = {}) {
    const lab = await this.load(cwd, name);
    const base = expected.base || await git(lab.source, ['rev-parse', 'HEAD']);
    await this.assertBase(lab, base);
    await this.validateBranch(lab, branch);
    return this.snapshot(lab, requested, base, async ({ workspace, components, tree }) => {
      if (expected.tree && tree !== expected.tree) throw new Error('Candidate assets changed after review. Review and approve again.');
      if (tree === await git(workspace, ['rev-parse', `${base}^{tree}`])) throw new Error('No selected changes to promote.');
      const identity = value => {
        const match = value.match(/^(.*) <([^<>]+)> (\d+) ([+-]\d{4})$/);
        if (!match) throw new Error('Configure Git user.name and user.email before promoting.');
        return match.slice(1);
      };
      const [authorName, authorEmail, authorTime, authorZone] = identity(await git(lab.source, ['var', 'GIT_AUTHOR_IDENT']));
      const [committerName, committerEmail, committerTime, committerZone] = identity(await git(lab.source, ['var', 'GIT_COMMITTER_IDENT']));
      const commit = await git(workspace, ['commit-tree', tree, '-p', base, '-m', `Promote skill lab: ${name}`], {
        GIT_AUTHOR_NAME: authorName, GIT_AUTHOR_EMAIL: authorEmail, GIT_AUTHOR_DATE: `${authorTime} ${authorZone}`,
        GIT_COMMITTER_NAME: committerName, GIT_COMMITTER_EMAIL: committerEmail, GIT_COMMITTER_DATE: `${committerTime} ${committerZone}`,
      });
      // Transfer objects only; atomically create a NEW branch. Leave checkout, index,
      // dirty project edits, and FETCH_HEAD untouched. No copied hooks are executed.
      await git(lab.source, ['fetch', '--no-write-fetch-head', '--no-tags', '--', workspace, commit]);
      await this.assertBase(lab, base);
      await git(lab.source, ['update-ref', `refs/heads/${branch}`, commit, '']);
      return { branch, commit, components, source: lab.source };
    });
  }
}
