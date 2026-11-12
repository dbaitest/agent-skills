// Where each supported agent reads Agent Skills from. Checked against the vendors' docs on
// 2026-11-12 (see README). Cursor and GitHub Copilot also read .claude/skills, and Copilot reads
// .github/skills, but .agents/skills is the location all three non-Claude agents share, so two
// directories cover all four agents.

import os from 'node:os';
import path from 'node:path';

export const AGENTS = {
  claude: { project: ['.claude', 'skills'], global: ['.claude', 'skills'] },
  codex: { project: ['.agents', 'skills'], global: ['.agents', 'skills'] },
  cursor: { project: ['.agents', 'skills'], global: ['.agents', 'skills'] },
  copilot: { project: ['.agents', 'skills'], global: ['.agents', 'skills'] },
};

/**
 * The skill directories to write, one per distinct location.
 * @param {string[]} agents agent names from AGENTS
 * @param {{global: boolean, projectDir: string, homeDir?: string}} scope
 * @returns {{dir: string, agents: string[]}[]}
 */
export function resolveTargets(agents, { global, projectDir, homeDir = os.homedir() }) {
  const base = global ? homeDir : projectDir;
  const byDir = new Map();
  for (const agent of agents) {
    const dir = path.join(base, ...AGENTS[agent][global ? 'global' : 'project']);
    byDir.set(dir, [...(byDir.get(dir) ?? []), agent]);
  }
  return [...byDir].map(([dir, names]) => ({ dir, agents: names }));
}
