// Every skill in skills/ follows the Agent Skills specification (https://agentskills.io/specification)
// closely enough for every agent we install into to load it, and carries the metadata the
// installer relies on.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readFrontmatter, SOURCE } from '../src/skill-metadata.mjs';

const skillsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills');
const ALLOWED_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const skills = readdirSync(skillsDir).filter((name) => existsSync(path.join(skillsDir, name, 'SKILL.md')));

it('the package ships at least one skill', () => {
  assert.ok(skills.length > 0);
});

for (const name of skills) {
  describe(`skills/${name}`, () => {
    const text = readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8');
    const frontmatter = readFrontmatter(text);
    const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';

    it('has frontmatter with only the keys the spec allows', () => {
      assert.ok(frontmatter, 'SKILL.md starts with --- frontmatter ---');
      const keys = [...block.matchAll(/^([\w-]+):/gm)].map((m) => m[1]);
      assert.deepEqual(keys.filter((k) => !ALLOWED_KEYS.has(k)), []);
    });

    it('has a valid name equal to its directory', () => {
      assert.equal(frontmatter.name, name);
      assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(name.length <= 64);
    });

    it('has a description agents can match on, within the limit', () => {
      assert.ok(frontmatter.description.length >= 50, 'says what it does and when to use it');
      assert.ok(frontmatter.description.length <= 1024);
      assert.match(frontmatter.description, /\bUse when\b/);
    });

    it('carries the installer and compatibility metadata', () => {
      assert.equal(frontmatter.metadata.source, SOURCE);
      assert.match(frontmatter.metadata['dbaitest-version'] ?? '', /^\d+\.\d+\.\d+$/);
      assert.ok(frontmatter.compatibility && frontmatter.compatibility.length <= 500);
    });

    it('keeps the body short; details live in references/', () => {
      const bodyLines = text.slice(text.indexOf('\n---\n', 4) + 5).split('\n').length;
      assert.ok(bodyLines <= 500, `${bodyLines} lines`);
    });

    it('only links to files that exist', () => {
      const referenced = [...text.matchAll(/`((?:references|scripts|templates)\/[\w./-]+)`/g)].map((m) => m[1]);
      for (const relative of referenced) {
        assert.ok(existsSync(path.join(skillsDir, name, relative)), `${relative} is missing`);
      }
    });
  });
}
