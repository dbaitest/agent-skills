#!/usr/bin/env node
// Fails unless the npm tarball holds exactly what users need: the installer, the skills, and
// the package metadata. A published version can never be changed, so a leaked test fixture,
// plan or script would be there for good.
//
//   node scripts/check-pack.mjs

import { execSync } from 'node:child_process';

const ALLOWED = [
  /^package\.json$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^CHANGELOG\.md$/,
  /^compat\.json$/,
  /^bin\/[\w-]+\.mjs$/,
  /^src\/[\w-]+\.mjs$/,
  /^skills\/[a-z0-9-]+\/(SKILL\.md|versions\.json|(references|scripts|templates)\/.+)$/,
];
const REQUIRED = ['package.json', 'README.md', 'LICENSE', 'bin/dbaitest-skills.mjs', 'compat.json'];

// A fixed command string through the shell, because npm is npm.cmd on Windows.
const output = execSync('npm pack --dry-run --json --ignore-scripts', { encoding: 'utf8' });
const files = JSON.parse(output)[0].files.map((f) => f.path.replace(/\\/g, '/')).sort();

const unexpected = files.filter((file) => !ALLOWED.some((pattern) => pattern.test(file)));
const missing = REQUIRED.filter((file) => !files.includes(file));
const skills = new Set(files.filter((f) => f.startsWith('skills/')).map((f) => f.split('/')[1]));
const skillsWithoutManifest = [...skills].filter((s) => !files.includes(`skills/${s}/SKILL.md`));

if (unexpected.length + missing.length + skillsWithoutManifest.length > 0) {
  for (const file of unexpected) console.error(`unexpected in the package: ${file}`);
  for (const file of missing) console.error(`missing from the package: ${file}`);
  for (const skill of skillsWithoutManifest) console.error(`skills/${skill} has no SKILL.md in the package`);
  process.exit(1);
}
console.log(`Package holds the expected ${files.length} files (${skills.size} skill${skills.size === 1 ? '' : 's'}).`);
