#!/usr/bin/env node
// Compiles the C# examples in a skill reference into a generated test project, so an example an
// agent copies is one that builds and passes. Each example is marked with the fixture repository
// whose schema it runs against:
//
//   <!-- snippet: sqlproj-shop -->
//   ```csharp
//   using …;            (hoisted to the top of the file)
//   [TestMethod] …       (members of the generated DatabaseTests class)
//   ```
//
//   node scripts/check-reference-snippets.mjs --fixture sqlproj-shop --project <generated project dir>
//
// Writes <project>/ReferenceSnippets.<reference>.cs; then run dotnet test on the project.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    fixture: { type: 'string' },
    project: { type: 'string' },
    reference: { type: 'string', default: 'skills/dbaitest-scaffold/references/writing-tests.md' },
  },
});
if (!values.fixture || !values.project) {
  console.error('usage: node scripts/check-reference-snippets.mjs --fixture <name> --project <dir> [--reference <md>]');
  process.exit(2);
}

const markdown = readFileSync(path.join(repoRoot, values.reference), 'utf8');
const blocks = [...markdown.matchAll(/<!--\s*snippet:\s*([\w-]+)\s*-->\s*```csharp\n([\s\S]*?)```/g)]
  .filter(([, fixture]) => fixture === values.fixture)
  .map(([, , code]) => code);
if (blocks.length === 0) {
  console.error(`No examples in ${values.reference} are marked for ${values.fixture}.`);
  process.exit(1);
}

const usings = new Set();
const members = [];
for (const block of blocks) {
  const body = [];
  for (const line of block.split('\n')) {
    if (/^using [\w.]+;\s*$/.test(line)) usings.add(line.trim());
    else body.push(`    ${line}`.trimEnd());
  }
  members.push(body.join('\n').trim());
}

const csproj = readdirSync(values.project).find((f) => f.endsWith('.csproj'));
const namespace = /<RootNamespace>([^<]+)</.exec(readFileSync(path.join(values.project, csproj), 'utf8'))[1];
const source = `// Generated from ${values.reference} by scripts/check-reference-snippets.mjs.
${[...usings].sort().join('\n')}

namespace ${namespace};

public partial class DatabaseTests
{
    ${members.join('\n\n    ')}
}
`;
// One file per reference: two references can then be checked in the same project, and their
// examples share the class without overwriting each other.
const fileName = `ReferenceSnippets.${path.basename(values.reference).replace(/\.md$/i, '')}.cs`;
writeFileSync(path.join(values.project, fileName), source);
console.log(`Wrote ${blocks.length} example(s) for ${values.fixture} into ${path.join(values.project, fileName)}.`);
