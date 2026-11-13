#!/usr/bin/env node
// Generates a new DbAiTest MSTest project. The skill's agents run this instead of writing the
// files by hand, and CI runs the same script, so what CI proves is what users get.
//
// Run it from the repository root: --dir, --sqlproj and --dacpac are resolved against the
// current directory, not against the skill directory the script lives in.
//
//   node <skill-dir>/scripts/scaffold.mjs --name Shop.Database.Tests --engines mssql,postgres
//   node <skill-dir>/scripts/scaffold.mjs --name Shop.Database.Tests --schema dacpac --sqlproj db/Shop.Database.sqlproj
//
// Exit codes: 0 written, 1 failed, 2 bad arguments.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { csprojPath, dacpacNameOf, detectFramework, isSdkStyleSqlproj, usesCentralPackages } from './project-environment.mjs';
import { ENGINES, packagesFor, projectFiles } from './project-files-from-options.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const versions = JSON.parse(readFileSync(path.join(skillRoot, 'versions.json'), 'utf8'));

const USAGE = `Usage: node scaffold.mjs --name <Project.Name> [options]   (run from the repository root)

  --name <name>          Project name, also the root namespace (e.g. Shop.Database.Tests).
  --dir <path>           Where to create the project (default: ./<name>).
  --engines <list>       Comma-separated: ${Object.keys(ENGINES).join(', ')}. Required for scripts
                         (run discover.mjs to find the one the repository uses).
  --schema <kind>        scripts (default): SQL files per engine under Schema/<engine>/.
                         dacpac: deploy a SQL Server .dacpac (SQL Server only).
  --schema-dir <path>    With scripts and one engine: the repository's existing schema folder,
                         linked into the project instead of a starter schema.
  --exclude-dir <name>   With --schema-dir: a folder name (at any depth) that is not schema, such as
                         seed data or one-off scripts; repeatable.
  --sqlproj <path>       With --schema dacpac: an SDK-style database project to build and deploy.
  --dacpac <path>        With --schema dacpac: a prebuilt .dacpac to deploy instead.
  --framework <tfm>      ${versions.targetFrameworks.join(' | ')} (default: newest the SDK in effect there can build).
  --force                Write into a directory that is not empty.
  --help                 Show this text.`;

export class UsageError extends Error {}

/** True when a directory holds a folder of this name at any depth. */
function containsDirectoryNamed(dir, name) {
  return readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isDirectory()
    && (entry.name.toLowerCase() === name.toLowerCase() || containsDirectoryNamed(path.join(dir, entry.name), name)));
}

/** True when a directory holds a .sql or .psql file at any depth. */
function containsSql(dir) {
  return readdirSync(dir, { withFileTypes: true }).some((entry) => (entry.isDirectory()
    ? containsSql(path.join(dir, entry.name))
    : /\.(sql|psql)$/i.test(entry.name)));
}

/** Validates the command line and resolves it into generator options. Throws UsageError. */
export function parseOptions(argv, { cwd = process.cwd(), framework = detectFramework } = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        name: { type: 'string' },
        dir: { type: 'string' },
        engines: { type: 'string' },
        schema: { type: 'string', default: 'scripts' },
        sqlproj: { type: 'string' },
        dacpac: { type: 'string' },
        'schema-dir': { type: 'string' },
        'exclude-dir': { type: 'string', multiple: true },
        framework: { type: 'string' },
        force: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }

  if (values.help) {
    return { help: true };
  }
  if (!values.name || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(values.name)) {
    throw new UsageError('--name must be a C# namespace such as Shop.Database.Tests.');
  }
  if (!['scripts', 'dacpac'].includes(values.schema)) {
    throw new UsageError(`--schema must be scripts or dacpac, not '${values.schema}'.`);
  }

  if (values.engines === undefined && values.schema === 'scripts') {
    throw new UsageError('--engines is required: name the engine(s) the repository uses (discover.mjs reports them).');
  }
  const engines = values.engines !== undefined
    ? [...new Set(values.engines.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))]
    : ['mssql'];
  const unknown = engines.filter((e) => !(e in ENGINES));
  if (unknown.length > 0 || engines.length === 0) {
    throw new UsageError(`Unknown engine(s): ${unknown.join(', ') || '(none given)'}. Use ${Object.keys(ENGINES).join(', ')}.`);
  }

  const projectDir = path.resolve(cwd, values.dir ?? values.name);
  const chosenFramework = values.framework ?? framework(projectDir, versions.targetFrameworks);
  if (!versions.targetFrameworks.includes(chosenFramework)) {
    throw new UsageError(`--framework must be one of ${versions.targetFrameworks.join(', ')}.`);
  }

  const options = { name: values.name, engines, schema: values.schema, framework: chosenFramework, projectDir, force: values.force };

  const excludeDirs = values['exclude-dir'] ?? [];
  if (values.schema !== 'dacpac') {
    if (values.sqlproj || values.dacpac) {
      throw new UsageError('--sqlproj and --dacpac only apply with --schema dacpac.');
    }
    if (values['schema-dir'] === undefined) {
      if (excludeDirs.length > 0) {
        throw new UsageError('--exclude-dir only applies with --schema-dir.');
      }
      return options;
    }
    if (engines.length !== 1) {
      throw new UsageError('--schema-dir links one engine\'s schema: give exactly one engine.');
    }
    const schemaDir = path.resolve(cwd, values['schema-dir']);
    if (!existsSync(schemaDir) || !statSync(schemaDir).isDirectory() || !containsSql(schemaDir)) {
      throw new UsageError(`--schema-dir must be a directory holding .sql files: ${schemaDir}`);
    }
    const within = (child, parent) => {
      const relative = path.relative(parent, child);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    };
    if (within(projectDir, schemaDir)) {
      // The project's own bin/ would match the schema glob and nest a copy on every build.
      throw new UsageError(`--dir ${projectDir} is inside --schema-dir ${schemaDir}: put the test project beside the schema folder.`);
    }
    const badExclusion = excludeDirs.find((d) => !/^[\w. -]+$/.test(d) || d.trim() !== d);
    if (badExclusion !== undefined) {
      throw new UsageError(`--exclude-dir takes a folder name, not a path: ${badExclusion}`);
    }
    // DbAiTest excludes a folder of that name at any depth under the schema folder.
    const missing = excludeDirs.find((d) => !containsDirectoryNamed(schemaDir, d));
    if (missing !== undefined) {
      throw new UsageError(`--exclude-dir ${missing}: no folder of that name under ${schemaDir}.`);
    }
    return { ...options, schemaDirPath: csprojPath(projectDir, schemaDir), excludeDirs };
  }
  if (values['schema-dir'] !== undefined || excludeDirs.length > 0) {
    throw new UsageError('--schema-dir and --exclude-dir only apply with --schema scripts.');
  }

  if (engines.length !== 1 || engines[0] !== 'mssql') {
    throw new UsageError('--schema dacpac deploys to SQL Server only: use --engines mssql (or leave it out).');
  }
  if (Boolean(values.sqlproj) === Boolean(values.dacpac)) {
    throw new UsageError('--schema dacpac needs exactly one of --sqlproj <path> or --dacpac <path>.');
  }

  const flag = values.sqlproj ? '--sqlproj' : '--dacpac';
  const expected = values.sqlproj ? '.sqlproj' : '.dacpac';
  const source = path.resolve(cwd, values.sqlproj ?? values.dacpac);
  if (path.extname(source).toLowerCase() !== expected || !existsSync(source) || !statSync(source).isFile()) {
    throw new UsageError(`${flag} must point to an existing ${expected} file: ${source}`);
  }

  if (values.sqlproj) {
    if (!isSdkStyleSqlproj(readFileSync(source, 'utf8'))) {
      throw new UsageError(
        `${source} is a classic (Visual Studio SSDT) database project, which the dotnet CLI cannot build. `
        + 'Build it in Visual Studio or with MSBuild, then pass the .dacpac it produces with --dacpac.',
      );
    }
    options.dacpacFileName = dacpacNameOf(source, readFileSync(source, 'utf8'));
    options.sqlprojPath = csprojPath(projectDir, source);
  } else {
    options.dacpacFileName = path.basename(source); // keep its case: Linux file systems are case-sensitive
    options.dacpacPath = { directory: csprojPath(projectDir, path.dirname(source)) };
  }
  return options;
}

function fail(message, code) {
  process.stderr.write(`error: ${message}\n`);
  if (code === 2) {
    process.stderr.write(`\n${USAGE}\n`);
  }
  process.exit(code);
}

function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    fail(error.message, error instanceof UsageError ? 2 : 1);
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const { projectDir } = options;
  if (existsSync(projectDir)) {
    if (!statSync(projectDir).isDirectory()) {
      fail(`${projectDir} exists and is not a directory. Pick another --dir.`, 1);
    }
    if (readdirSync(projectDir).length > 0 && !options.force) {
      fail(`${projectDir} is not empty. Pick another --dir, or pass --force to write into it.`, 1);
    }
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
      'Central package management is on: add to Directory.Packages.props the ones it does not already have:',
      ...packagesFor(options, versions).map(([id, version]) => `  <PackageVersion Include="${id}" Version="${version}" />`),
    );
  }
  lines.push('', 'Next: make sure Docker is running, then run `dotnet test` in that directory.');
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
