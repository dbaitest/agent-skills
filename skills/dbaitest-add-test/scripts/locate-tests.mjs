#!/usr/bin/env node
// Reads a repository (never writes, never builds) and reports, as JSON, the DbAiTest test
// project it already has: the abstract test class the tests belong in, the class per engine
// that runs them, where the schema comes from, and the tests that are already there.
//
//   node <skill-dir>/scripts/locate-tests.mjs [--root <repository>]
//
// The agent shows the report to the user and adds tests to the class the report names, instead
// of guessing where they belong. An empty report is a valid answer: the repository has no
// DbAiTest test project yet, and the scaffolder creates one.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  dbaitestPackages,
  isDbAiTestProject,
  parseTestClasses,
  projectInfo,
  schemaSourceOf,
  testLayout,
} from './test-project-signals.mjs';

// Every dot-directory (.git, .vs, .idea, .venv, .next, .terraform, .claude, .agents …) is skipped
// too; these are build output, dependencies and tooling.
const SKIPPED_DIRECTORIES = new Set([
  'node_modules', 'bin', 'obj', 'TestResults', 'packages', 'artifacts', 'dist', 'build', 'out',
  'coverage', 'vendor', 'target', 'Pods', 'venv', '__pycache__', 'bower_components', 'jspm_packages',
]);
const MAX_DEPTH = 8;
const MAX_DIRECTORIES = 50_000;

const toPosix = (p) => p.split(path.sep).join('/');

/** The project files in the repository, honouring the skip list and the limits. */
function projectFiles(root) {
  const files = [];
  let directories = 0;
  let truncated = false;
  const visit = (dir, depth) => {
    if (depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
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
      if (entry.name.startsWith('.') && entry.isDirectory()) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          visit(full, depth + 1);
        }
      } else if (/\.(csproj|fsproj|vbproj)$/i.test(entry.name)) {
        files.push(full);
      }
    }
  };
  visit(root, 0);
  return { files, truncated };
}

/** The C# files of a project directory: the tests, and the classes per engine. */
function sourceFiles(dir) {
  const files = [];
  const visit = (current, depth) => {
    if (depth > 4) {
      return;
    }
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
          visit(full, depth + 1);
        }
      } else if (/\.cs$/i.test(entry.name)) {
        files.push(full);
      }
    }
  };
  visit(dir, 0);
  return files;
}

/** The report for a repository root. Exported for tests. */
export function locate(root) {
  const rel = (p) => toPosix(path.relative(root, p)) || '.';
  const testProjects = [];
  const libraryProjects = [];
  const { files: projects, truncated } = projectFiles(root);

  for (const projectFile of projects) {
    const text = readFileSync(projectFile, 'utf8');
    const packages = dbaitestPackages(text);
    if (packages.length === 0) {
      continue;
    }
    if (!isDbAiTestProject(text)) {
      // A project that only uses the DbAiTest libraries is not a test project; the agent must
      // not be offered it as one.
      libraryProjects.push({ projectFile: rel(projectFile), packages });
      continue;
    }
    const dir = path.dirname(projectFile);
    const info = projectInfo(text, path.basename(projectFile));
    const schema = schemaSourceOf(text);

    const classes = [];
    for (const file of sourceFiles(dir)) {
      const source = readFileSync(file, 'utf8');
      for (const parsed of parseTestClasses(source)) {
        classes.push({ ...parsed, file: rel(file) });
      }
    }
    const layout = testLayout(classes);

    // The project file says where the schema comes from; a project that deploys a dacpac or a
    // directory through the SchemaSource property, or that names a schema folder for the
    // harness, says so in its test class instead.
    const source = layout.baseTestClass?.schemaSource ?? null;
    if (schema.kind === 'none') {
      if (source) {
        schema.kind = source === 'DacpacSchemaSource' ? 'dacpac' : 'source';
      } else if (layout.engineClasses.some((c) => c.schemaRoot)) {
        schema.kind = 'scripts';
      }
    }
    schema.source = source;

    const byName = (name) => classes.find((c) => c.name === name);
    testProjects.push({
      projectFile: rel(projectFile),
      dir: rel(dir),
      name: info.name,
      rootNamespace: info.rootNamespace,
      frameworks: info.frameworks,
      packages: info.packages,
      schema,
      baseTestClass: layout.baseTestClass
        ? { ...layout.baseTestClass, file: byName(layout.baseTestClass.name)?.file ?? null }
        : null,
      engineClasses: layout.engineClasses.map((c) => ({ ...c, file: byName(c.name)?.file ?? null })),
      testClasses: layout.testClasses.map((c) => ({ ...c, file: byName(c.name)?.file ?? null })),
      testMethods: layout.testMethods.map((m) => ({ ...m, file: byName(m.class)?.file ?? null })),
      engines: [...new Set([
        ...layout.engineClasses.map((c) => c.engine),
        layout.baseTestClass?.engine,
      ].filter(Boolean))],
    });
  }

  return { root: toPosix(root), testProjects, libraryProjects, truncated };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let root;
  try {
    const { values } = parseArgs({ options: { root: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
    if (values.help) {
      process.stdout.write('Usage: node locate-tests.mjs [--root <repository>]   (prints a JSON report; changes nothing)\n');
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
  process.stdout.write(`${JSON.stringify(locate(root), null, 2)}\n`);
}
