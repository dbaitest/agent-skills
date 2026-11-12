#!/usr/bin/env node
// compat.json is the one place that names the dbaitest versions the skills are written and
// tested against. Skills are installed as plain directories (by our installer or by
// `npx skills add`), so each one carries its own copy:
//   skills/<name>/versions.json         read by the skill's scripts
//   skills/<name>/SKILL.md  metadata    dbaitest-version, shown to the agent
//
//   node scripts/sync-compat.mjs           write the copies
//   node scripts/sync-compat.mjs --check   exit 1 if a copy differs (CI)

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const compat = JSON.parse(readFileSync(path.join(repoRoot, 'compat.json'), 'utf8'));

const versionsJson = `${JSON.stringify(compat, null, 2)}\n`;
const drift = [];

function sync(file, expected) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current === expected) {
    return;
  }
  drift.push(path.relative(repoRoot, file));
  if (!check) {
    writeFileSync(file, expected, 'utf8');
  }
}

const skillsDir = path.join(repoRoot, 'skills');
for (const name of readdirSync(skillsDir)) {
  const skillDir = path.join(skillsDir, name);
  const skillMd = path.join(skillDir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    continue;
  }

  sync(path.join(skillDir, 'versions.json'), versionsJson);

  const text = readFileSync(skillMd, 'utf8');
  const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(text)?.[0];
  const pattern = /^(\s+dbaitest-version:\s*)"[^"]*"/m;
  if (!frontmatter || !pattern.test(frontmatter)) {
    console.error(`${path.relative(repoRoot, skillMd)}: frontmatter metadata has no dbaitest-version line.`);
    process.exit(1);
  }
  sync(skillMd, frontmatter.replace(pattern, `$1"${compat.dbaitest}"`) + text.slice(frontmatter.length));

  // Prose that names the supported frameworks is not rewritten, only checked, so a compat change
  // that adds or drops a framework cannot leave it stale.
  const majors = compat.targetFrameworks.map((tfm) => tfm.slice(3).split('.')[0]);
  const expectations = [
    ['SKILL.md', (t) => majors.every((m) => new RegExp(`^compatibility:.*\\b${m}\\b`, 'm').test(t)), `compatibility names .NET ${majors.join(' and ')}`],
    [path.join('references', 'ci.md'), (t) => majors.every((m) => t.includes(`${m}.0.x`)), `setup-dotnet installs ${majors.map((m) => `${m}.0.x`).join(', ')}`],
    [path.join('references', 'troubleshooting.md'), (t) => t.includes(`--framework ${compat.targetFrameworks[0]}`), `suggests --framework ${compat.targetFrameworks[0]}`],
  ];
  for (const [relative, holds, what] of expectations) {
    const file = path.join(skillDir, relative);
    if (existsSync(file) && !holds(readFileSync(file, 'utf8'))) {
      drift.push(`${path.relative(repoRoot, file)} (by hand: ${what})`);
    }
  }
}

if (drift.length === 0) {
  console.log(`Skills match compat.json (DbAiTest ${compat.dbaitest}).`);
} else if (check) {
  console.error(`Out of date with compat.json; run node scripts/sync-compat.mjs:\n  ${drift.join('\n  ')}`);
  process.exit(1);
} else {
  console.log(`Updated:\n  ${drift.join('\n  ')}`);
}
