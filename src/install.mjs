// add / remove / list. Each command first works out every change for every target and refuses
// before touching anything if one of them is not allowed; only then does it write. Directory
// replacement itself is in replace-directory-safely.mjs.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { removeDirectory, replaceDirectory, sweepStaging } from './replace-directory-safely.mjs';
import { digestDirectory, isOurs, readSkill } from './skill-metadata.mjs';
import { AGENTS, resolveTargets } from './targets.mjs';

/** A condition the user must resolve. exitCode 2 marks a bad argument, 1 anything else. */
export class InstallError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const PLAIN_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const version = (dir) => readSkill(dir)?.metadata['dbaitest-version'] ?? '?';

/** The path with symbolic links resolved (macOS /var is /private/var), for comparing places. */
const realPath = (p) => (existsSync(p) ? realpathSync.native(p) : path.resolve(p));

/** Skills shipped in packageSkillsDir. */
function shippedSkills(packageSkillsDir) {
  return readdirSync(packageSkillsDir).filter((name) => readSkill(path.join(packageSkillsDir, name)) !== null);
}

/** The requested skills, or every shipped one; an unknown name is a usage error. */
export function selectSkills(packageSkillsDir, requested) {
  const available = shippedSkills(packageSkillsDir);
  const unknown = requested.filter((name) => !available.includes(name));
  if (unknown.length > 0) {
    throw new InstallError(`Unknown skill(s): ${unknown.join(', ')}. This package has: ${available.join(', ')}.`, 2);
  }
  return requested.length > 0 ? requested : available;
}

/** True when git says the path is ignored; false when it is not or git is unavailable. */
function ignoredByGit(projectDir, target) {
  return spawnSync('git', ['check-ignore', '-q', path.relative(projectDir, target)], { cwd: projectDir }).status === 0;
}

/** .gitignore advice for a skills directory git ignores, e.g. ".claude/skills". */
function gitignoreAdvice(relative) {
  const [parent] = relative.split('/');
  return `warning: git ignores ${relative}. To commit it, replace a "${parent}/" line in .gitignore with "${parent}/*" and add "!${relative}/".`;
}

function refuse(blocked) {
  throw new InstallError(blocked.join('\n'));
}

/** Installs the skills into every target. Returns the lines to print. */
export function add({ packageSkillsDir, skills, agents, global, projectDir, homeDir, force, dryRun }) {
  const names = selectSkills(packageSkillsDir, skills);
  const targets = resolveTargets(agents, { global, projectDir, homeDir });

  const actions = [];
  const blocked = [];
  for (const { dir, agents: forAgents } of targets) {
    for (const name of names) {
      const source = path.join(packageSkillsDir, name);
      const dest = path.join(dir, name);
      const label = `${name} → ${dest} (${forAgents.join(', ')})`;
      if (!existsSync(dest)) {
        actions.push({ kind: 'install', source, dest, label });
      } else if (!isOurs(dest)) {
        blocked.push(`${dest} exists and was not installed by @dbaitest/skills; remove or rename it first.`);
      } else if (digestDirectory(dest) === digestDirectory(source)) {
        actions.push({ kind: 'current', label });
      } else if (force) {
        actions.push({ kind: 'replace', source, dest, label, from: version(dest), to: version(source) });
      } else {
        blocked.push(
          `${dest} differs from this version (DbAiTest ${version(dest)} → ${version(source)}): `
          + 'run again with --force to replace it (local edits are lost).',
        );
      }
    }
  }
  if (blocked.length > 0) {
    refuse(blocked);
  }

  const lines = [];
  if (!dryRun) {
    targets.forEach((t) => sweepStaging(t.dir));
  }
  for (const action of actions) {
    if (action.kind === 'current') {
      lines.push(`up to date  ${action.label}`);
      continue;
    }
    if (!dryRun) {
      replaceDirectory(action.source, action.dest);
    }
    lines.push(action.kind === 'install'
      ? `${dryRun ? 'would install' : 'installed'}  ${action.label}`
      : `${dryRun ? 'would replace' : 'replaced'}  ${action.label} (DbAiTest ${action.from} → ${action.to})`);
  }

  // A project install is meant to be committed; not when the "project" is the home directory.
  if (!global && !dryRun && realPath(projectDir) !== realPath(homeDir)) {
    const relative = targets.map((t) => path.relative(projectDir, t.dir).split(path.sep).join('/'));
    lines.push('', 'Commit these directories so everyone on the project gets the skills:', ...relative.map((r) => `  ${r}`));
    relative.filter((r, i) => ignoredByGit(projectDir, targets[i].dir)).forEach((r) => lines.push(gitignoreAdvice(r)));
  }
  return lines;
}

/**
 * Removes skills this installer owns from every target: the named ones, or all of them. A copy
 * that differs from the one this package ships (edited, or a skill this version no longer
 * ships) is only removed with --force.
 */
export function remove({ packageSkillsDir, skills, agents, global, projectDir, homeDir, force, dryRun }) {
  const invalid = skills.filter((name) => !PLAIN_NAME.test(name));
  if (invalid.length > 0) {
    throw new InstallError(`Not a skill name: ${invalid.join(', ')}.`, 2);
  }
  const shipped = shippedSkills(packageSkillsDir);

  const actions = [];
  const blocked = [];
  const skipped = [];
  for (const { dir } of resolveTargets(agents, { global, projectDir, homeDir })) {
    const present = existsSync(dir) ? readdirSync(dir) : [];
    const names = skills.length > 0 ? skills.filter((n) => present.includes(n)) : present.filter((n) => isOurs(path.join(dir, n)));
    for (const name of names) {
      const dest = path.join(dir, name);
      if (!isOurs(dest)) {
        skipped.push(`skipped  ${dest}: not installed by @dbaitest/skills`);
      } else if (force || (shipped.includes(name) && digestDirectory(dest) === digestDirectory(path.join(packageSkillsDir, name)))) {
        actions.push(dest);
      } else {
        blocked.push(`${dest} differs from the copy this version ships (edited, or from another version): run again with --force to remove it.`);
      }
    }
  }
  if (blocked.length > 0) {
    refuse(blocked);
  }

  const lines = [...skipped];
  for (const dest of actions) {
    if (!dryRun) {
      removeDirectory(dest);
    }
    lines.push(`${dryRun ? 'would remove' : 'removed'}  ${dest}`);
  }
  return lines.length > 0 ? lines : ['Nothing to remove.'];
}

/** Every skill this installer owns, in the project and in the home directory. */
export function list({ projectDir, homeDir }) {
  const lines = [];
  const seen = new Set();
  for (const global of [false, true]) {
    for (const { dir, agents } of resolveTargets(Object.keys(AGENTS), { global, projectDir, homeDir })) {
      if (!existsSync(dir) || seen.has(realPath(dir))) {
        continue; // run from the home directory, project and global are the same place
      }
      seen.add(realPath(dir));
      for (const name of readdirSync(dir).sort()) {
        const skillDir = path.join(dir, name);
        if (isOurs(skillDir)) {
          lines.push(`${global ? 'global ' : 'project'}  ${name}  DbAiTest ${version(skillDir)}  ${skillDir} (${agents.join(', ')})`);
        }
      }
    }
  }
  return lines.length > 0 ? lines : ['No dbaitest skills installed.'];
}
