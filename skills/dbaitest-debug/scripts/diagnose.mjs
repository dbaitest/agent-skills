#!/usr/bin/env node
// Runs a DbAiTest test project and reports, as JSON, what failed: the test, the engine class it
// failed in, the message, the stack trace and the container log lines of that test.
//
//   node <skill-dir>/scripts/diagnose.mjs --project <project dir or .csproj> [options]
//
// The console output of a red suite is long and the first error is the one that explains the
// rest. This script runs the suite with the result logger and reads the result file instead, so the
// report is short, structured and says which engine failed.
//
// It exits 0 whenever it produced a report, even when the tests failed: a red suite is an answer,
// not a script error. Exit 1 means the run produced no result file at all (a build failure, a
// filter that matched nothing); exit 2 is a usage error.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { parseTrx } from './trx-report.mjs';

// The console output of a failing suite is long; the default 1 MB buffer would cut the run off.
const MAX_OUTPUT = 64 * 1024 * 1024;

/** The project file of a test project: the .csproj in the folder, or the file itself. */
function projectFile(project) {
  if (!existsSync(project)) {
    throw new Error(`${project} does not exist.`);
  }
  if (statSync(project).isFile()) {
    return project;
  }
  const found = readdirSync(project).filter((f) => f.endsWith('.csproj'));
  if (found.length !== 1) {
    throw new Error(`${project} holds ${found.length} project files; name the .csproj.`);
  }
  return path.join(project, found[0]);
}

/**
 * Runs the project and returns the report. Exported for tests.
 * @param {{project: string, filter?: string, configuration?: string, results?: string}} options
 */
export function diagnose(options) {
  const project = projectFile(path.resolve(options.project));
  const results = options.results
    ? path.resolve(options.results)
    : mkdtempSync(path.join(os.tmpdir(), 'dbaitest-diagnose-'));
  mkdirSync(results, { recursive: true });

  // Every run writes its own result file, so a kept results folder never shows a stale run.
  const fileName = `results-${Date.now()}.trx`;
  const args = [
    'test', project,
    '--logger', `trx;LogFileName=${fileName}`,
    '--results-directory', results,
  ];
  if (options.filter) {
    args.push('--filter', options.filter);
  }
  if (options.configuration) {
    args.push('--configuration', options.configuration);
  }

  // No shell: the arguments are passed as they are, so a path with a space and a filter with
  // VSTest's operators (`|`, `&`) reach dotnet unchanged.
  const run = spawnSync('dotnet', args, { encoding: 'utf8', maxBuffer: MAX_OUTPUT });
  const log = path.join(results, 'dotnet-test.log');
  writeFileSync(log, `${run.stdout ?? ''}${run.stderr ?? ''}`, 'utf8');

  const trx = path.join(results, fileName);
  if (!existsSync(trx)) {
    // The run happened but produced no result file: the project did not build, or the filter
    // matched no test. The console output names the reason.
    return {
      project,
      ran: true,
      resultFile: null,
      exitCode: run.status,
      log,
      error: (run.stdout || run.stderr || run.error?.message || 'dotnet test produced no result file')
        .trim()
        .split('\n')
        .slice(-20)
        .join('\n'),
    };
  }

  return {
    project,
    ran: true,
    exitCode: run.status,
    log,
    resultFile: trx,
    ...parseTrx(readFileSync(trx, 'utf8')),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        project: { type: 'string' },
        filter: { type: 'string' },
        configuration: { type: 'string' },
        results: { type: 'string' },
        help: { type: 'boolean' },
      },
      strict: true,
    }));
    if (values.help) {
      process.stdout.write('Usage: node diagnose.mjs --project <dir> [--filter <expr>] [--configuration <cfg>] [--results <dir>]\n');
      process.exit(0);
    }
    if (!values.project) {
      throw new Error('--project is required.');
    }
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exit(2);
  }

  let report;
  try {
    report = diagnose(values);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  // The report is the result: a red suite is an answer, not a script failure.
  process.exit(report.resultFile ? 0 : 1);
}
