// add / remove / list. Every change to a skill directory is a rename of a fully written sibling,
// so an interrupted run never leaves a half-copied skill that an agent would load.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

import { digestDirectory, isOurs, readSkill } from './skill-metadata.mjs';
import { AGENTS, resolveTargets } from './targets.mjs';

/** Thrown for a condition the user must resolve; the CLI prints it and exits 1. */
export class InstallError extends Error {}

/** Skill names shipped in packageSkillsDir, or the requested subset (unknown names throw). */
export function selectSkills(packageSkillsDir, requested) {
  const available = readdirSync(packageSkillsDir).filter((name) => readSkill(path.join(packageSkillsDir, name)) !== null);
  const unknown = requested.filter((name) => !available.includes(name));
  if (unknown.length > 0) {
    throw new InstallError(`Unknown skill(s): ${unknown.join(', ')}. This package has: ${available.join(', ')}.`);
  }
  return requested.length > 0 ? requested : available;
}

const version = (dir) => readSkill(dir)?.metadata['dbaitest-version'] ?? '?';

/** Copies source to dest via a temporary sibling, replacing dest if it exists. */
function replaceDirectory(source, dest) {
  const staging = `${dest}.installing-${process.pid}`;
  const old = `${dest}.replaced-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(source, staging, { recursive: true });
  if (existsSync(dest)) {
    renameSync(dest, old);
  }
  renameSync(staging, dest);
  rmSync(old, { recursive: true, force: true });
}

/** True when git says the path is ignored; false when it is not or git is unavailable. */
function ignoredByGit(projectDir, target) {
  const result = spawnSync('git', ['check-ignore', '-q', path.relative(projectDir, target)], { cwd: projectDir });
  return result.status === 0;
}

/**
 * Installs the skills into every target. Returns the lines to print; throws InstallError when a
 * target holds a copy it must not overwrite.
 */
export function add({ packageSkillsDir, skills, agents, global, projectDir, homeDir, force, dryRun }) {
  const names = selectSkills(packageSkillsDir, skills);
  const targets = resolveTargets(agents, { global, projectDir, homeDir });
  const lines = [];
  const blocked = [];

  for (const { dir, agents: forAgents } of targets) {
    for (const name of names) {
      const source = path.join(packageSkillsDir, name);
      const dest = path.join(dir, name);
      const label = `${dest} (${forAgents.join(', ')})`;

      if (!existsSync(dest)) {
        if (!dryRun) {
          replaceDirectory(source, dest);
        }
        lines.push(`${dryRun ? 'would install' : 'installed'}  ${name} → ${label}`);
      } else if (!isOurs(dest)) {
        blocked.push(`${dest} exists and was not installed by @dbaitest/skills; remove or rename it first.`);
      } else if (digestDirectory(dest) === digestDirectory(source)) {
        lines.push(`up to date  ${name} → ${label}`);
      } else if (force) {
        if (!dryRun) {
          replaceDirectory(source, dest);
        }
        lines.push(`${dryRun ? 'would replace' : 'replaced'}   ${name} → ${label} (DbAiTest ${version(dest)} → ${version(source)})`);
      } else {
        blocked.push(
          `${dest} differs from this version (DbAiTest ${version(dest)} → ${version(source)}): `
          + 'run again with --force to replace it (local edits are lost).',
        );
      }
    }
  }

  if (blocked.length > 0) {
    throw new InstallError([...lines, ...blocked].join('\n'));
  }

  if (!global && !dryRun) {
    const ignored = targets.map((t) => t.dir).filter((dir) => ignoredByGit(projectDir, dir));
    lines.push('', 'Commit these directories so everyone on the project gets the skills:');
    lines.push(...targets.map((t) => `  ${path.relative(projectDir, t.dir) || '.'}`));
    for (const dir of ignored) {
      lines.push(`warning: git ignores ${path.relative(projectDir, dir)}; add a "!${path.relative(projectDir, dir).split(path.sep).join('/')}/" exception to .gitignore to commit it.`);
    }
  }
  return lines;
}

/** Removes the named skills (default: every skill this installer owns) from every target. */
export function remove({ packageSkillsDir, skills, agents, global, projectDir, homeDir, dryRun }) {
  const requested = skills.length > 0 ? selectSkills(packageSkillsDir, skills) : null;
  const lines = [];
  for (const { dir } of resolveTargets(agents, { global, projectDir, homeDir })) {
    // Without names: every skill in the target this installer owns, including ones a newer
    // package no longer ships.
    const names = requested ?? (existsSync(dir) ? readdirSync(dir).filter((name) => isOurs(path.join(dir, name))) : []);
    for (const name of names) {
      const dest = path.join(dir, name);
      if (!existsSync(dest)) {
        continue;
      }
      if (!isOurs(dest)) {
        lines.push(`skipped  ${dest}: not installed by @dbaitest/skills`);
        continue;
      }
      if (!dryRun) {
        rmSync(dest, { recursive: true, force: true });
      }
      lines.push(`${dryRun ? 'would remove' : 'removed'}  ${dest}`);
    }
  }
  return lines.length > 0 ? lines : ['Nothing to remove.'];
}

/** Every skill this installer owns, in the project and in the home directory. */
export function list({ projectDir, homeDir }) {
  const lines = [];
  for (const global of [false, true]) {
    for (const { dir, agents } of resolveTargets(Object.keys(AGENTS), { global, projectDir, homeDir })) {
      if (!existsSync(dir)) {
        continue;
      }
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
