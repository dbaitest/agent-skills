#!/usr/bin/env node
// Fails when a skill names a DbAiTest API that does not exist in the DbAiTest version the skill
// pins. A skill that teaches a renamed type or member makes the agent write code that does not
// compile, so CI runs this against a checkout of dbaitest/db-test at the tag in compat.json.
//
//   node scripts/check-identifiers.mjs --dbtest <db-test checkout at v<compat.dbaitest>>

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compat = JSON.parse(readFileSync(path.join(repoRoot, 'compat.json'), 'utf8'));
const { values } = parseArgs({ options: { dbtest: { type: 'string' } } });
if (!values.dbtest) {
  console.error('usage: node scripts/check-identifiers.mjs --dbtest <db-test checkout>');
  process.exit(2);
}

// The checkout must be the pinned release, or newer APIs would pass.
const expectedTag = `v${compat.dbaitest}`;
let tag = '';
try {
  tag = execFileSync('git', ['-C', values.dbtest, 'describe', '--tags', '--exact-match', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  // Not at a tag at all: reported below.
}
if (tag !== expectedTag) {
  console.error(`${values.dbtest} is at '${tag || 'no tag'}', not ${expectedTag} (compat.json).`);
  process.exit(1);
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

// Code only: comments and prose do not count as an API existing.
const stripComments = (cs) => cs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const sources = new Map(
  filesUnder(path.join(values.dbtest, 'src'))
    .filter((file) => file.endsWith('.cs'))
    .map((file) => [file, stripComments(readFileSync(file, 'utf8'))]),
);
const projects = filesUnder(path.join(values.dbtest, 'src')).filter((file) => file.endsWith('.csproj'));
const allCode = [...sources.values()].join('\n');
const word = (name) => new RegExp(`\\b${name.replace(/\./g, '\\.')}\\b`);

const namespaces = new Set([...allCode.matchAll(/^namespace\s+([\w.]+)/gm)].map((m) => m[1]));
const packageIds = new Set(projects.map((file) => path.basename(file, '.csproj')));

/** The source of the file that declares a type, or null. */
function declarationOf(type) {
  const declares = new RegExp(`\\b(?:class|record|struct|interface|enum)\\s+${type}\\b`);
  return [...sources.values()].find((code) => declares.test(code)) ?? null;
}

/** Members visible on a type: its own file plus its base classes declared in db-test. */
function typeHasMember(type, member) {
  for (let current = type; current; ) {
    const code = declarationOf(current);
    if (code === null) {
      return false;
    }
    if (word(member).test(code)) {
      return true;
    }
    current = new RegExp(`\\b(?:class|record)\\s+${current}\\b[^:{]*:\\s*(\\w+)`).exec(code)?.[1];
  }
  return false;
}

// Receivers the skills use, mapped to the DbAiTest type they are.
const RECEIVER_TYPES = { Harness: 'DbAiTestHarness' };

// Names that look like DbAiTest API but belong to .NET, MSTest or DacFx.
const NOT_DBAITEST = new Set(['DacDeployOptions', 'InvalidOperationException', 'DbAiTestVersion']);

/** Every API reference in a text, as {kind, name, type?}. */
function references(text) {
  const refs = [];
  for (const [, name] of text.matchAll(/\b(DbAiTest(?:\.[A-Z]\w*)+)\b/g)) {
    refs.push({ kind: 'namespace-or-package', name });
  }
  for (const [, name] of text.matchAll(/\b(DbAiTest\w+)\b/g)) {
    refs.push({ kind: 'type', name });
  }
  // By suffix: a type (MsSqlEngine, DbContainerOptions) or a member (CreateEngine, ContainerOptions).
  for (const [, name] of text.matchAll(/\b(\w+(?:Engine|SchemaSource|Options|Exception|ParameterValue|Harness))\b/g)) {
    if (!name.startsWith('DbAiTest')) {
      refs.push({ kind: 'code', name });
    }
  }
  for (const [, receiver, member] of text.matchAll(/\b(Harness|DbAiTest\w+|DacpacSchemaSource|SchemaLoader|EngineRegistry)\.([A-Z]\w*)/g)) {
    refs.push({ kind: 'member', type: RECEIVER_TYPES[receiver] ?? receiver, name: member });
  }
  for (const [, member] of text.matchAll(/\boverride\s+[\w?<>[\]]+\s+([A-Z]\w*)/g)) {
    refs.push({ kind: 'member', type: 'DbAiTestBase', name: member });
  }
  for (const [, name] of text.matchAll(/\b(DBAITEST_[A-Z_]+)\b/g)) {
    refs.push({ kind: 'literal', name });
  }
  return refs;
}

function exists(ref) {
  switch (ref.kind) {
    case 'namespace-or-package':
      return namespaces.has(ref.name) || packageIds.has(ref.name);
    case 'type':
      return declarationOf(ref.name) !== null;
    case 'member':
      return typeHasMember(ref.type, ref.name);
    case 'code':
      return word(ref.name).test(allCode);
    default:
      return allCode.includes(ref.name);
  }
}

// Text the skills show to agents or emit into projects: Markdown and templates in full, and the
// string literals of the generator scripts (package ids and namespaces live there).
function scannedText(file) {
  const text = readFileSync(file, 'utf8');
  if (!file.endsWith('.mjs')) {
    return text;
  }
  return [...text.matchAll(/'([^'\n]*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2]).join('\n');
}

const skillFiles = filesUnder(path.join(repoRoot, 'skills')).filter((file) => /\.(md|tmpl|mjs)$/.test(file));
const missing = new Map();
for (const file of skillFiles) {
  for (const ref of references(scannedText(file))) {
    if (NOT_DBAITEST.has(ref.name) || exists(ref)) {
      continue;
    }
    const label = ref.kind === 'member' ? `${ref.type}.${ref.name}` : ref.name;
    const where = missing.get(label) ?? new Set();
    where.add(path.relative(repoRoot, file));
    missing.set(label, where);
  }
}

if (missing.size > 0) {
  console.error(`Skill files name DbAiTest APIs that do not exist in ${expectedTag}:`);
  for (const [label, files] of missing) {
    console.error(`  ${label}  (${[...files].join(', ')})`);
  }
  process.exit(1);
}
console.log(`Every DbAiTest identifier in ${skillFiles.length} skill files exists in ${expectedTag}.`);
