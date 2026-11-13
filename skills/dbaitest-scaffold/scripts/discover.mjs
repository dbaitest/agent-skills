#!/usr/bin/env node
// Reads a repository (never writes, never builds) and reports, as JSON, what the scaffolder
// needs to decide: which database engine the application uses, with the evidence, and which
// database projects already exist (SDK-style or classic .sqlproj, folders of .sql scripts).
//
//   node <skill-dir>/scripts/discover.mjs [--root <repository>]
//
// The agent shows the evidence to the user and only asks about what this leaves open.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isSdkStyleSqlproj, usesCentralPackages } from './project-environment.mjs';
import {
  dialectOf,
  dialectScores,
  enginesFromConfigText,
  enginesFromProjectFile,
  isTestProject,
  NON_SCHEMA_FOLDER,
  SCHEMA_ROOT_FOLDER,
} from './repository-signals.mjs';

const SKIPPED_DIRECTORIES = new Set([
  '.git', '.vs', '.idea', '.vscode', '.claude', '.agents', '.github', 'node_modules', 'bin', 'obj',
  'TestResults', 'packages', 'artifacts', 'dist', 'build', 'out', 'coverage',
]);
const MAX_DEPTH = 8;
const MAX_FILES = 20_000;
const MAX_SQL_BYTES_PER_FOLDER = 2_000_000;
const CONFIG_FILE = /^(appsettings(\.[\w-]+)?\.json|(web|app)\.config|\.env(\.[\w-]+)?|(docker-)?compose(\.[\w-]+)?\.ya?ml|launchSettings\.json)$/i;

const toPosix = (p) => p.split(path.sep).join('/');

/** Every file under root that discovery looks at, honouring the skip list and the limits. */
function walk(root) {
  const files = [];
  let truncated = false;
  const visit = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable: not ours to report
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIPPED_DIRECTORIES.has(entry.name)) {
          visit(full, depth + 1);
        } else if (depth >= MAX_DEPTH) {
          truncated = true;
        }
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  visit(root, 0);
  return { files, truncated };
}

const read = (file, limit = 512_000) => {
  try {
    const text = readFileSync(file, 'utf8');
    return text.length > limit ? text.slice(0, limit) : text;
  } catch {
    return '';
  }
};

/** The dacpac file name a database project builds. */
function dacpacNameOf(sqlprojPath, text) {
  const target = /<SqlTargetName>\s*([^<\s]+)\s*</i.exec(text)?.[1] ?? /<TargetName>\s*([^<\s]+)\s*</i.exec(text)?.[1];
  return `${target ?? path.basename(sqlprojPath, path.extname(sqlprojPath))}.dacpac`;
}

/** Built copies of a dacpac under the project's bin/ (bin is skipped by the walk, so look here). */
function builtDacpacs(sqlprojDir, dacpacName) {
  const found = [];
  const visit = (dir, depth) => {
    if (depth > 4 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
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
      sqlprojs.push({
        path: rel(file),
        sdkStyle: isSdkStyleSqlproj(text),
        dacpacName: dacpacNameOf(file, text),
        builtDacpacs: builtDacpacs(path.dirname(file), dacpacNameOf(file, text)).map(rel),
      });
      evidence.push({ engine: 'mssql', signal: 'SQL Server database project', file: rel(file) });
    } else if (CONFIG_FILE.test(name)) {
      evidence.push(...enginesFromConfigText(read(file)).map((e) => ({ ...e, file: rel(file) })));
    }
  }

  // Script folders: .sql/.psql files outside database projects and test projects, grouped by
  // their schema root.
  const sqlprojDirs = sqlprojs.map((s) => path.join(root, path.dirname(s.path)));
  const inside = (file, dirs) => dirs.some((dir) => file.startsWith(dir + path.sep));
  const groups = new Map();
  for (const file of files) {
    if (!/\.(sql|psql)$/i.test(file) || inside(file, sqlprojDirs) || inside(file, testProjectDirs)) {
      continue;
    }
    const groupRoot = schemaRootOf(root, path.dirname(file));
    groups.set(groupRoot, [...(groups.get(groupRoot) ?? []), file]);
  }

  const scriptFolders = [...groups].map(([dir, sqlFiles]) => {
    let budget = MAX_SQL_BYTES_PER_FOLDER;
    let sql = '';
    for (const file of sqlFiles.sort()) {
      if (budget <= 0) break;
      const text = read(file, budget);
      sql += `\n${text}`;
      budget -= text.length;
    }
    const scores = dialectScores(sql);
    const dialect = dialectOf(scores);
    const subfolders = [...new Set(sqlFiles.map((f) => path.relative(dir, path.dirname(f)).split(path.sep)[0]).filter(Boolean))].sort();
    if (dialect) {
      evidence.push({ engine: dialect, signal: `SQL dialect of ${sqlFiles.length} script(s)`, file: rel(dir) });
    }
    const suggestedExclusions = subfolders.filter((s) => NON_SCHEMA_FOLDER.test(s));
    // Where SchemaRoot should point: the one subfolder holding every schema file when the rest
    // are excluded (db/schema next to db/seed), else the folder itself with the exclusions.
    const schemaFiles = sqlFiles.filter((f) => !suggestedExclusions.includes(path.relative(dir, path.dirname(f)).split(path.sep)[0]));
    const schemaSubfolders = [...new Set(schemaFiles.map((f) => path.relative(dir, path.dirname(f)).split(path.sep)[0]))];
    const single = schemaSubfolders.length === 1 && schemaSubfolders[0] !== '' && suggestedExclusions.length > 0;
    return {
      path: rel(dir),
      files: sqlFiles.length,
      dialect,
      dialectScores: scores,
      subfolders,
      suggestedExclusions,
      schemaDir: single ? rel(path.join(dir, schemaSubfolders[0])) : rel(dir),
      excludeFromSchemaDir: single ? [] : suggestedExclusions,
    };
  }).sort((a, b) => b.files - a.files);

  const engines = ['mssql', 'postgres', 'mysql']
    .map((engine) => ({ engine, evidence: evidence.filter((e) => e.engine === engine).map(({ signal, file }) => ({ signal, file })) }))
    .filter((e) => e.evidence.length > 0)
    .sort((a, b) => b.evidence.length - a.evidence.length);

  const top = readdirSync(root);
  const solution = top.find((f) => /\.slnx?$/i.test(f)) ?? null;
  const testsFolder = ['tests', 'test'].find((d) => top.includes(d) && statSync(path.join(root, d)).isDirectory()) ?? null;

  return {
    root: toPosix(root),
    engine: engines.length === 1 ? engines[0].engine : null,
    engines,
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
