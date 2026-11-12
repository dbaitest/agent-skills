// Reads the few SKILL.md frontmatter fields the installer needs. The frontmatter is YAML, but the
// installer only ever reads its own skills' simple `key: value` lines, so a full YAML parser (a
// runtime dependency) is not worth it.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** The package name every skill this installer ships carries in metadata.source. */
export const SOURCE = '@dbaitest/skills';

const unquote = (value) => value.trim().replace(/^(["'])(.*)\1$/, '$2');

/**
 * Top-level and `metadata:` fields of a SKILL.md frontmatter.
 * @returns {{name?: string, metadata: Record<string, string>} | null} null without frontmatter
 */
export function readFrontmatter(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1];
  if (block === undefined) {
    return null;
  }
  const result = { metadata: {} };
  let inMetadata = false;
  for (const line of block.split(/\r?\n/)) {
    const top = /^([\w-]+):\s*(.*)$/.exec(line);
    if (top) {
      inMetadata = top[1] === 'metadata' && top[2].trim() === '';
      if (!inMetadata) {
        result[top[1]] = unquote(top[2]);
      }
      continue;
    }
    const nested = /^\s+([\w-]+):\s*(.*)$/.exec(line);
    if (inMetadata && nested) {
      result.metadata[nested[1]] = unquote(nested[2]);
    }
  }
  return result;
}

/** Frontmatter of the skill in dir, or null when dir has no readable SKILL.md frontmatter. */
export function readSkill(dir) {
  const file = path.join(dir, 'SKILL.md');
  return existsSync(file) ? readFrontmatter(readFileSync(file, 'utf8')) : null;
}

/** True when the directory holds a skill this installer put there. */
export const isOurs = (dir) => readSkill(dir)?.metadata.source === SOURCE;

/** A digest of every file's relative path and bytes, to tell an installed copy from ours. */
export function digestDirectory(dir) {
  const hash = createHash('sha256');
  const walk = (current) => {
    for (const entry of readdirSync(current).sort()) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        hash.update(path.relative(dir, full).split(path.sep).join('/'));
        hash.update('\0');
        hash.update(readFileSync(full));
        hash.update('\0');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}
