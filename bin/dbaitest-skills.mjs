#!/usr/bin/env node
// npx @dbaitest/skills [add|remove|list] [skill...] [options]
// Exit codes: 0 done, 1 failed (nothing half-installed), 2 bad arguments.

import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCommandLine, USAGE, UsageError } from '../src/args.mjs';
import { add, InstallError, list, remove } from '../src/install.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usageError(message) {
  process.stderr.write(`error: ${message}\n\n${USAGE}\n`);
  return 2;
}

function main() {
  let options;
  try {
    options = parseCommandLine(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      return usageError(error.message);
    }
    throw error;
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

  const projectDir = path.resolve(options.dir ?? process.cwd());
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    return usageError(`--dir ${projectDir} is not an existing directory.`);
  }

  const context = { ...options, packageSkillsDir: path.join(packageRoot, 'skills'), projectDir, homeDir: os.homedir() };
  try {
    const actions = { add, remove, list };
    process.stdout.write(`${actions[options.command](context).join('\n')}\n`);
    return 0;
  } catch (error) {
    if (error instanceof InstallError) {
      process.stderr.write(`error: ${error.message}\n`);
      return error.exitCode;
    }
    if (error.code) {
      // A file system error (permissions, a locked file): the message says which path.
      process.stderr.write(`error: ${error.message}\n`);
      if (['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) {
        process.stderr.write('Nothing was changed. A file in that folder may be open in another program; close it and run again.\n');
      }
      return 1;
    }
    throw error;
  }
}

process.exitCode = main();
