#!/usr/bin/env node
// npx @dbaitest/skills [add|remove|list] [skill...] [options]
// Exit codes: 0 done, 1 failed (nothing half-installed), 2 bad arguments.

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCommandLine, USAGE, UsageError } from '../src/args.mjs';
import { add, InstallError, list, remove } from '../src/install.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main() {
  let options;
  try {
    options = parseCommandLine(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n\n${USAGE}\n`);
    return error instanceof UsageError ? 2 : 1;
  }

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (options.version) {
    const { version } = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    process.stdout.write(`${version}\n`);
    return 0;
  }

  const context = {
    ...options,
    packageSkillsDir: path.join(packageRoot, 'skills'),
    projectDir: path.resolve(options.dir ?? process.cwd()),
    homeDir: os.homedir(),
  };

  try {
    const actions = { add, remove, list };
    process.stdout.write(`${actions[options.command](context).join('\n')}\n`);
    return 0;
  } catch (error) {
    if (error instanceof InstallError) {
      process.stderr.write(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = main();
