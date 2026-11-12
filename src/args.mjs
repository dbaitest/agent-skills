// Command line of `npx @dbaitest/skills`. Kept separate from the actions so it can be tested
// without touching the file system.

import { parseArgs } from 'node:util';

import { AGENTS } from './targets.mjs';

export const COMMANDS = ['add', 'remove', 'list'];

export const USAGE = `Usage: npx @dbaitest/skills [add|remove|list] [skill...] [options]

Commands:
  add [skill...]      Install skills (default command; default: every skill in the package).
  remove [skill...]   Remove skills this installer put there (default: all of them).
  list                Show the dbaitest skills installed for this project and globally.

Options:
  --global            Use your home directory instead of the project.
  --agent <name>      ${Object.keys(AGENTS).join(' | ')} | all (repeatable; default: all).
  --dir <path>        The project directory (default: the current directory).
  --force             Replace an installed copy that differs from this version (local edits are lost).
  --dry-run           Print what would change; change nothing.
  --version           Print the package version.
  --help              Show this text.

Where skills go:
  claude                      .claude/skills/<skill>   (~/.claude/skills with --global)
  codex, cursor, copilot      .agents/skills/<skill>   (~/.agents/skills with --global)`;

export class UsageError extends Error {}

/** Parses argv into {command, skills, agents, global, dir, force, dryRun, help, version}. */
export function parseCommandLine(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        global: { type: 'boolean', default: false },
        agent: { type: 'string', multiple: true },
        dir: { type: 'string' },
        force: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
    });
  } catch (error) {
    throw new UsageError(error.message);
  }

  const { values, positionals } = parsed;
  const [first, ...rest] = positionals;
  const command = COMMANDS.includes(first) ? first : 'add';
  const skills = COMMANDS.includes(first) ? rest : positionals;
  if (command === 'list' && skills.length > 0) {
    throw new UsageError('list takes no skill names.');
  }

  const requested = (values.agent ?? ['all']).flatMap((a) => a.split(',')).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const unknown = requested.filter((a) => a !== 'all' && !Object.hasOwn(AGENTS, a));
  if (unknown.length > 0 || requested.length === 0) {
    throw new UsageError(`Unknown agent(s): ${unknown.join(', ') || '(none given)'}. Use ${Object.keys(AGENTS).join(', ')} or all.`);
  }
  const agents = requested.includes('all') ? Object.keys(AGENTS) : [...new Set(requested)];

  return {
    command,
    skills,
    agents,
    global: values.global,
    dir: values.dir,
    force: values.force,
    dryRun: values['dry-run'],
    help: values.help,
    version: values.version,
  };
}
