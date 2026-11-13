#!/usr/bin/env node
// Reads a repository (never writes, never builds) and reports, as JSON, what the scaffolder
// needs to decide: which database engine the application uses, with the evidence, and which
// database projects already exist (SDK-style or classic .sqlproj, folders of .sql scripts).
//
//   node <skill-dir>/scripts/discover.mjs [--root <repository>]
//
// The agent shows the evidence to the user and only asks about what this leaves open.

import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { dacpacNameOf, isSdkStyleSqlproj, usesCentralPackages } from './project-environment.mjs';
import {
  dialectOf,
  dialectScores,
  ENGINE_FOLDER,
  enginesFromConfigText,
  enginesFromProjectFile,
  isTestProject,
  MIGRATIONS_FOLDER,
  NON_SCHEMA_FOLDER,
  OBJECT_TYPE_FOLDER,
  SCHEMA_ROOT_FOLDER,
  SUPPORTED_ENGINES,
  VERSIONED_MIGRATION_FILE,
} from './repository-signals.mjs';

// Every dot-directory (.git, .vs, .idea, .venv, .next, .terraform, .claude, .agents …) is skipped
// too; these are build output, dependencies and tooling.
const SKIPPED_DIRECTORIES = new Set([
  'node_modules', 'bin', 'obj', 'TestResults', 'packages', 'artifacts', 'dist', 'build', 'out',
  'coverage', 'vendor', 'target', 'Pods', 'venv', '__pycache__', 'bower_components', 'jspm_packages',
]);
const MAX_DEPTH = 8;
const MAX_RELEVANT_FILES = 20_000; // project, configuration and .sql files; others are not counted
const MAX_DIRECTORIES = 50_000;
const MAX_SQL_BYTES_PER_FOLDER = 2_000_000;
const CONFIG_FILE = /^(appsettings(\.[\w-]+)?\.json|local\.settings\.json|(web|app)\.config|\.env(\.[\w-]+)?|(docker-)?compose(\.[\w-]+)?\.ya?ml|launchSettings\.json)$/i;
const RELEVANT_FILE = /\.(csproj|fsproj|vbproj|sqlproj|sql|psql)$/i;

const toPosix = (p) => p.split(path.sep).join('/');

/** The files discovery looks at, honouring the skip list and the limits. */
function walk(root) {
  const files = [];
  let directories = 0;
  let truncated = false;
  const visit = (dir, depth) => {
    if (++directories > MAX_DIRECTORIES) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable: not ours to report
    }
    for (const entry of entries) {
      if (files.length >= MAX_RELEVANT_FILES) {
        truncated = true;
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        if (depth < MAX_DEPTH) {
          visit(full, depth + 1);
        } else {
          truncated = true;
        }
      } else if (entry.isFile() && (RELEVANT_FILE.test(entry.name) || CONFIG_FILE.test(entry.name))) {
        files.push(full); // symbolic links are neither directories nor files here: not followed
      }
    }
  };
  visit(root, 0);
  return { files, truncated };
}

/** The first `limit` bytes of a file as text, without reading the rest (a .sql dump can be huge). */
function read(file, limit = 512_000) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buffer = Buffer.alloc(limit);
    const bytes = readSync(fd, buffer, 0, limit, 0);
    return buffer.subarray(0, bytes).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Built copies of a dacpac under the project's bin/ (bin is skipped by the walk, so look here). */
function builtDacpacs(sqlprojDir, dacpacName) {
  const found = [];
  const visit = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.name.toLowerCase() === dacpacName.toLowerCase()) found.push(full);
    }
  };
  visit(path.join(sqlprojDir, 'bin'), 0);
  return found;
}

/**
 * The folder a .sql file's schema is rooted at: the outermost schema-named ancestor (db/ for
 * db/schema/x.sql and db/seed/y.sql alike), else the file's own folder.
 */
function schemaRootOf(root, fileDir) {
  let found = fileDir;
  for (let dir = fileDir; dir.startsWith(root) && dir !== root; dir = path.dirname(dir)) {
    if (SCHEMA_ROOT_FOLDER.test(path.basename(dir))) {
      found = dir;
    }
  }
  return found;
}

const firstSegment = (dir, file) => path.relative(dir, path.dirname(file)).split(path.sep)[0];

function sqlOf(files) {
  let budget = MAX_SQL_BYTES_PER_FOLDER;
  let sql = '';
  for (const file of [...files].sort()) {
    if (budget <= 0) break;
    const text = read(file, Math.min(budget, 512_000));
    sql += `\n${text}`;
    budget -= text.length;
  }
  return sql;
}

/**
 * Splits a group whose first-level subfolders are separate databases: named after an engine, or
 * written in different dialects.
 */
function splitByEngine(dir, files) {
  const bySubfolder = new Map();
  for (const file of files) {
    const sub = firstSegment(dir, file);
    bySubfolder.set(sub, [...(bySubfolder.get(sub) ?? []), file]);
  }
  const subs = [...bySubfolder.keys()].filter(Boolean);
  const engineNamed = subs.filter((s) => Object.values(ENGINE_FOLDER).some((p) => p.test(s)));
  const dialects = new Set(subs.map((s) => dialectOf(dialectScores(sqlOf(bySubfolder.get(s))))).filter(Boolean));
  if (subs.length > 1 && (engineNamed.length > 0 || dialects.size > 1)) {
    return [...bySubfolder].map(([sub, subFiles]) => [sub ? path.join(dir, sub) : dir, subFiles]);
  }
  return [[dir, files]];
}

function describeFolder(root, dir, sqlFiles) {
  const rel = (p) => toPosix(path.relative(root, p)) || '.';
  const scores = dialectScores(sqlOf(sqlFiles));
  const dialect = dialectOf(scores);
  const subfolders = [...new Set(sqlFiles.map((f) => firstSegment(dir, f)).filter(Boolean))].sort();
  const others = subfolders.filter((s) => !NON_SCHEMA_FOLDER.test(s) && !MIGRATIONS_FOLDER.test(s));
  // Migrations beside a schema folder are its history: applying both creates objects twice.
  const suggestedExclusions = subfolders.filter((s) => NON_SCHEMA_FOLDER.test(s) || (MIGRATIONS_FOLDER.test(s) && others.length > 0));
  const schemaFiles = sqlFiles.filter((f) => !suggestedExclusions.includes(firstSegment(dir, f)));
  const schemaSubfolders = [...new Set(schemaFiles.map((f) => firstSegment(dir, f)))];
  const single = schemaSubfolders.length === 1 && schemaSubfolders[0] !== '' && suggestedExclusions.length > 0;
  const atRoot = dir === root;

  // Two or more sibling folders that each create tables, named neither after object types nor
  // as seed/migrations, may be separate databases (database/Billing, database/Shop).
  const tableFolders = schemaSubfolders.filter((s) => s !== '' && !OBJECT_TYPE_FOLDER.test(s)
    && /\bCREATE\s+TABLE\b/i.test(sqlOf(schemaFiles.filter((f) => firstSegment(dir, f) === s))));

  return {
    path: rel(dir),
    files: sqlFiles.length,
    dialect,
    dialectScores: scores,
    subfolders,
    suggestedExclusions,
    // Never the repository root: the test project would sit inside its own schema folder.
    schemaDir: atRoot ? null : single ? rel(path.join(dir, schemaSubfolders[0])) : rel(dir),
    excludeFromSchemaDir: single || atRoot ? [] : suggestedExclusions,
    versionedMigrations: sqlFiles.some((f) => VERSIONED_MIGRATION_FILE.test(path.basename(f))),
    possibleSeparateDatabases: tableFolders.length > 1 ? tableFolders : [],
  };
}

function sdkVersionAt(root) {
  try {
    return execFileSync('dotnet', ['--version'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Builds the report for a repository root. Exported for tests. */
export function discover(root, { sdkVersion = sdkVersionAt } = {}) {
  const { files, truncated } = walk(root);
  const rel = (p) => toPosix(path.relative(root, p)) || '.';

  const evidence = [];
  const testProjectDirs = [];
  const sqlprojs = [];
  for (const file of files) {
    const name = path.basename(file);
    const ext = path.extname(name).toLowerCase();
    if (ext === '.csproj' || ext === '.fsproj' || ext === '.vbproj') {
      const text = read(file);
      if (isTestProject(text)) {
        testProjectDirs.push(path.dirname(file));
      }
      evidence.push(...enginesFromProjectFile(text).map((e) => ({ ...e, file: rel(file) })));
    } else if (ext === '.sqlproj') {
      const text = read(file);
      const dacpacName = dacpacNameOf(file, text);
      sqlprojs.push({
        path: rel(file),
        sdkStyle: isSdkStyleSqlproj(text),
        dacpacName,
        builtDacpacs: builtDacpacs(path.dirname(file), dacpacName).map(rel),
      });
      evidence.push({ engine: 'mssql', signal: 'SQL Server database project', strength: 'strong', file: rel(file) });
    } else if (CONFIG_FILE.test(name)) {
      evidence.push(...enginesFromConfigText(read(file)).map((e) => ({ ...e, file: rel(file) })));
    }
  }

  // Script folders: .sql/.psql files outside database projects and test projects, grouped by
  // their schema root, then split where subfolders are separate databases.
  const sqlprojDirs = sqlprojs.map((s) => path.join(root, path.dirname(s.path)));
  const inside = (file, dirs) => dirs.some((dir) => file.startsWith(dir + path.sep));
  const groups = new Map();
  for (const file of files) {
    if (!/\.(sql|psql)$/i.test(file) || inside(file, sqlprojDirs) || inside(file, testProjectDirs)) {
      continue;
    }
    const groupRoot = schemaRootOf(root, path.dirname(file));
    if (!groups.has(groupRoot)) groups.set(groupRoot, []);
    groups.get(groupRoot).push(file);
  }

  const scriptFolders = [...groups]
    .flatMap(([dir, sqlFiles]) => splitByEngine(dir, sqlFiles))
    .map(([dir, sqlFiles]) => describeFolder(root, dir, sqlFiles))
    .sort((a, b) => b.files - a.files);
  for (const folder of scriptFolders) {
    if (folder.dialect) {
      evidence.push({ engine: folder.dialect, signal: `SQL dialect of ${folder.files} script(s)`, strength: 'weak', file: folder.path });
    }
  }

  const byEngine = (names) => names
    .map((engine) => ({
      engine,
      evidence: evidence.filter((e) => e.engine === engine).map(({ signal, strength, file }) => ({ signal, strength, file })),
    }))
    .filter((e) => e.evidence.length > 0)
    .sort((a, b) => b.evidence.length - a.evidence.length);
  const engines = byEngine(SUPPORTED_ENGINES);
  const unsupported = byEngine([...new Set(evidence.map((e) => e.engine))].filter((e) => !SUPPORTED_ENGINES.includes(e)));
  const engine = engines.length === 1 && unsupported.length === 0 ? engines[0].engine : null;

  let top = [];
  try {
    top = readdirSync(root, { withFileTypes: true });
  } catch {
    // reported as an empty repository
  }
  const solution = top.find((e) => e.isFile() && /\.slnx?$/i.test(e.name))?.name ?? null;
  const testsFolder = top.find((e) => e.isDirectory() && /^tests?$/i.test(e.name))?.name ?? null;

  return {
    root: toPosix(root),
    engine,
    // A package or a database project names the engine; configuration and dialect only hint.
    confident: engine !== null && engines[0].evidence.some((e) => e.strength === 'strong'),
    engines,
    unsupported,
    sqlprojs,
    scriptFolders,
    solution,
    testsFolder,
    centralPackages: usesCentralPackages(root),
    sdkVersion: sdkVersion(root),
    truncated,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let root;
  try {
    const { values } = parseArgs({ options: { root: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
    if (values.help) {
      process.stdout.write('Usage: node discover.mjs [--root <repository>]   (prints a JSON report; changes nothing)\n');
      process.exit(0);
    }
    root = path.resolve(values.root ?? process.cwd());
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new Error(`--root ${root} is not a directory.`);
    }
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(discover(root), null, 2)}\n`);
}
