#!/usr/bin/env node
// Generates a new DbAiTest MSTest project. The skill's agents run this instead of writing the
// files by hand, and CI runs the same script, so what CI proves is what users get.
//
//   node scaffold.mjs --name Shop.Database.Tests --engines mssql,postgres
//   node scaffold.mjs --name Shop.Database.Tests --schema dacpac --sqlproj ../Shop.Database/Shop.Database.sqlproj
//
// Exit codes: 0 written, 1 failed, 2 bad arguments.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { ENGINES, packagesFor, projectFiles } from './project-files-from-options.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versions = JSON.parse(readFileSync(path.join(skillRoot, 'versions.json'), 'utf8'));

const USAGE = `Usage: node scaffold.mjs --name <Project.Name> [options]

  --name <name>          Project name, also the root namespace (e.g. Shop.Database.Tests).
  --dir <path>           Where to create the project (default: ./<name>).
  --engines <list>       Comma-separated: ${Object.keys(ENGINES).join(', ')} (default: all three).
  --schema <kind>        scripts (default): SQL files per engine under Schema/<engine>/.
                         dacpac: deploy a SQL Server .dacpac (SQL Server only).
  --sqlproj <path>       With --schema dacpac: the database project to build and deploy.
  --dacpac <path>        With --schema dacpac: a prebuilt .dacpac to deploy instead.
  --framework <tfm>      ${versions.targetFrameworks.join(' | ')} (default: newest one an installed SDK supports).
  --force                Write into a directory that is not empty.
  --help                 Show this text.`;

class UsageError extends Error {}

function fail(message, code) {
  process.stderr.write(`error: ${message}\n`);
  if (code === 2) {
    process.stderr.write(`\n${USAGE}\n`);
  }
  process.exit(code);
}

/** Newest target framework the installed .NET SDKs can build; the oldest supported one if unknown. */
function detectFramework() {
  try {
    const sdks = execFileSync('dotnet', ['--list-sdks'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const majors = sdks.split('\n').map((line) => Number.parseInt(line, 10)).filter(Number.isFinite);
    const newest = Math.max(...majors);
    const supported = versions.targetFrameworks.filter((tfm) => Number.parseInt(tfm.slice(3), 10) <= newest);
    if (supported.length > 0) {
      return supported.at(-1);
    }
  } catch {
    // No dotnet on PATH: the agent's preflight reports it; generate for the floor framework.
  }
  return versions.targetFrameworks[0];
}

/** True when a Directory.Packages.props above the project turns on central package management. */
function usesCentralPackages(projectDir) {
  for (let dir = projectDir; ; dir = path.dirname(dir)) {
    const props = path.join(dir, 'Directory.Packages.props');
    if (existsSync(props) && /<ManagePackageVersionsCentrally>\s*true\s*</i.test(readFileSync(props, 'utf8'))) {
      return true;
    }
    if (path.dirname(dir) === dir) {
      return false;
    }
  }
}

/** MSBuild-style relative path (backslashes) from the project directory to a target. */
function msbuildRelative(fromDir, target) {
  return path.relative(fromDir, target).split(path.sep).join('\\');
}

function parseOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      name: { type: 'string' },
      dir: { type: 'string' },
      engines: { type: 'string' },
      schema: { type: 'string', default: 'scripts' },
      sqlproj: { type: 'string' },
      dacpac: { type: 'string' },
      framework: { type: 'string' },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  if (!values.name || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(values.name)) {
    throw new UsageError('--name must be a C# namespace such as Shop.Database.Tests.');
  }
  if (!['scripts', 'dacpac'].includes(values.schema)) {
    throw new UsageError(`--schema must be scripts or dacpac, not '${values.schema}'.`);
  }

  const engines = values.engines
    ? [...new Set(values.engines.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))]
    : values.schema === 'dacpac' ? ['mssql'] : Object.keys(ENGINES);
  const unknown = engines.filter((e) => !(e in ENGINES));
  if (unknown.length > 0 || engines.length === 0) {
    throw new UsageError(`Unknown engine(s): ${unknown.join(', ') || '(none given)'}. Use ${Object.keys(ENGINES).join(', ')}.`);
  }

  const framework = values.framework ?? detectFramework();
  if (!versions.targetFrameworks.includes(framework)) {
    throw new UsageError(`--framework must be one of ${versions.targetFrameworks.join(', ')}.`);
  }

  const projectDir = path.resolve(values.dir ?? values.name);
  const options = { name: values.name, engines, schema: values.schema, framework, projectDir, force: values.force };

  if (values.schema === 'dacpac') {
    if (engines.length !== 1 || engines[0] !== 'mssql') {
      throw new UsageError('--schema dacpac deploys to SQL Server only: use --engines mssql (or leave it out).');
    }
    if (Boolean(values.sqlproj) === Boolean(values.dacpac)) {
      throw new UsageError('--schema dacpac needs exactly one of --sqlproj <path> or --dacpac <path>.');
    }
    const source = path.resolve(values.sqlproj ?? values.dacpac);
    const expected = values.sqlproj ? '.sqlproj' : '.dacpac';
    if (path.extname(source).toLowerCase() !== expected || !existsSync(source)) {
      throw new UsageError(`${values.sqlproj ? '--sqlproj' : '--dacpac'} must point to an existing ${expected} file: ${source}`);
    }
    // An SDK-style database project builds <project file name>.dacpac.
    options.dacpacFileName = `${path.basename(source, path.extname(source))}.dacpac`;
    if (values.sqlproj) {
      options.sqlprojPath = msbuildRelative(projectDir, source);
    } else {
      options.dacpacPath = { directory: msbuildRelative(projectDir, path.dirname(source)) || '.' };
    }
  } else if (values.sqlproj || values.dacpac) {
    throw new UsageError('--sqlproj and --dacpac only apply with --schema dacpac.');
  }

  return options;
}

function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    fail(error.message, error instanceof UsageError || error.code?.startsWith('ERR_PARSE_ARGS') ? 2 : 1);
  }

  const { projectDir } = options;
  if (existsSync(projectDir) && readdirSync(projectDir).length > 0 && !options.force) {
    fail(`${projectDir} is not empty. Pick another --dir, or pass --force to write into it.`, 1);
  }

  options.centralPackages = usesCentralPackages(projectDir);
  const readTemplate = (relative) => readFileSync(path.join(skillRoot, 'templates', relative), 'utf8');
  const files = projectFiles(options, versions, readTemplate);

  for (const file of files) {
    const target = path.join(projectDir, ...file.path.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content.replace(/\r\n/g, '\n'), 'utf8');
  }

  const lines = [
    `Created ${options.name} (${options.framework}, DbAiTest ${versions.dbaitest}) in ${projectDir}:`,
    ...files.map((f) => `  ${f.path}`),
  ];
  if (options.centralPackages) {
    lines.push(
      '',
      'Central package management is on: add these to Directory.Packages.props:',
      ...packagesFor(options, versions).map(([id, version]) => `  <PackageVersion Include="${id}" Version="${version}" />`),
    );
  }
  lines.push('', 'Next: make sure Docker is running, then run `dotnet test` in that directory.');
  process.stdout.write(`${lines.join('\n')}\n`);
}

main();
