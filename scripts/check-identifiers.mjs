#!/usr/bin/env node
// Fails when a skill names a DbAiTest API that does not exist in the DbAiTest version the skill
// pins. A skill that teaches a renamed type or method makes the agent write code that does not
// compile, so this runs in CI against a checkout of dbaitest/db-test at the tag in compat.json.
//
//   node scripts/check-identifiers.mjs --dbtest <path to a db-test checkout at v<compat.dbaitest>>

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { dbtest: { type: 'string' } } });
if (!values.dbtest) {
  console.error('usage: node scripts/check-identifiers.mjs --dbtest <db-test checkout>');
  process.exit(2);
}

// What a skill can teach about DbAiTest, by shape rather than by a list of known names, so an
// invented or renamed API is caught too. Each pattern's first capture group is the name looked
// up (as a whole word) in db-test's src/ and README.
const PATTERNS = [
  /\b(DbAiTest(?:\.[A-Z]\w*)*)\b/g, // namespaces, package ids, DbAiTest* types
  /\b(\w+(?:Engine|SchemaSource|Options|Exception|ParameterValue|Harness))\b/g, // types by suffix
  /\b(?:Harness|DbAiTest\w+|DacpacSchemaSource|SchemaLoader|EngineRegistry)\.([A-Z]\w*)/g, // members used
  /\boverride\s+[\w?<>[\]]+\s+([A-Z]\w*)/g, // members a test class overrides
  /\b(DBAITEST_[A-Z_]+)\b/g, // environment variables
];

// Names that look like DbAiTest API but belong to .NET, MSTest or DacFx.
const NOT_DBAITEST = new Set(['DacDeployOptions', 'InvalidOperationException', 'ToString']);

function filesUnder(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

const haystack = [...filesUnder(path.join(values.dbtest, 'src')), path.join(values.dbtest, 'README.md')]
  .filter((file) => /\.(cs|csproj|md)$/.test(file))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

const known = new Set(haystack.match(/[\w.]+/g));
const exists = (token) => known.has(token) || new RegExp(`\\b${token.replace(/\./g, '\\.')}\\b`).test(haystack);

const missing = new Map();
// The generator's own JavaScript is not DbAiTest API; the text it emits lives in templates/.
const skillFiles = filesUnder(path.join(repoRoot, 'skills')).filter((file) => /\.(md|tmpl)$/.test(file));
for (const file of skillFiles) {
  const text = readFileSync(file, 'utf8');
  const tokens = PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]));
  for (const token of tokens) {
    if (!NOT_DBAITEST.has(token) && !exists(token)) {
      const where = missing.get(token) ?? new Set();
      where.add(path.relative(repoRoot, file));
      missing.set(token, where);
    }
  }
}

if (missing.size > 0) {
  console.error('Skill files name DbAiTest APIs that do not exist in the pinned version:');
  for (const [token, files] of missing) {
    console.error(`  ${token}  (${[...files].join(', ')})`);
  }
  process.exit(1);
}
console.log(`Every DbAiTest identifier in ${skillFiles.length} skill files exists in ${values.dbtest}.`);
