// End-to-end tests of `npx @dbaitest/skills` (bin/dbaitest-skills.mjs) in a temporary project
// and a temporary home directory, plus unit tests of argument parsing and target resolution.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCommandLine, UsageError } from '../src/args.mjs';
import { readFrontmatter } from '../src/skill-metadata.mjs';
import { resolveTargets } from '../src/targets.mjs';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/dbaitest-skills.mjs');
const root = mkdtempSync(path.join(os.tmpdir(), 'dbaitest-installer-'));
after(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
function sandbox() {
  const dir = path.join(root, `s${++counter}`);
  const project = path.join(dir, 'project');
  const home = path.join(dir, 'home');
  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { project, home };
}

function run({ project, home }, ...args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

const skill = (base, ...parts) => path.join(base, ...parts, 'dbaitest-scaffold', 'SKILL.md');

describe('parseCommandLine', () => {
  it('defaults to add, every agent, project scope', () => {
    const options = parseCommandLine([]);
    assert.equal(options.command, 'add');
    assert.deepEqual(options.agents, ['claude', 'codex', 'cursor', 'copilot']);
    assert.equal(options.global, false);
  });

  it('reads skills, repeated and comma-separated agents', () => {
    const options = parseCommandLine(['add', 'dbaitest-scaffold', '--agent', 'claude', '--agent', 'cursor,Codex']);
    assert.deepEqual(options.skills, ['dbaitest-scaffold']);
    assert.deepEqual(options.agents, ['claude', 'cursor', 'codex']);
  });

  it('treats a bare skill name as add', () => {
    assert.deepEqual(parseCommandLine(['dbaitest-scaffold']).skills, ['dbaitest-scaffold']);
  });

  it('rejects unknown agents, options and list arguments', () => {
    assert.throws(() => parseCommandLine(['--agent', 'windsurf']), UsageError);
    assert.throws(() => parseCommandLine(['--nope']), UsageError);
    assert.throws(() => parseCommandLine(['list', 'x']), UsageError);
  });
});

describe('resolveTargets', () => {
  it('collapses codex, cursor and copilot into one .agents/skills', () => {
    const targets = resolveTargets(['claude', 'codex', 'cursor', 'copilot'], { global: false, projectDir: '/p' });
    assert.deepEqual(targets.map((t) => [path.relative('/p', t.dir).split(path.sep).join('/'), t.agents]), [
      ['.claude/skills', ['claude']],
      ['.agents/skills', ['codex', 'cursor', 'copilot']],
    ]);
  });

  it('uses the home directory with --global', () => {
    const [target] = resolveTargets(['codex'], { global: true, projectDir: '/p', homeDir: '/h' });
    assert.equal(target.dir, path.join('/h', '.agents', 'skills'));
  });
});

describe('readFrontmatter', () => {
  it('reads top-level and metadata fields', () => {
    const fm = readFrontmatter('---\nname: x\nmetadata:\n  source: "@dbaitest/skills"\n  dbaitest-version: "0.4.0"\nlicense: MIT\n---\nbody');
    assert.equal(fm.name, 'x');
    assert.equal(fm.license, 'MIT');
    assert.deepEqual(fm.metadata, { source: '@dbaitest/skills', 'dbaitest-version': '0.4.0' });
  });

  it('is null without frontmatter', () => {
    assert.equal(readFrontmatter('# no frontmatter'), null);
  });
});

describe('add', () => {
  it('installs into both project directories by default', () => {
    const box = sandbox();
    const result = run(box, 'add');
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(skill(box.project, '.claude', 'skills')));
    assert.ok(existsSync(skill(box.project, '.agents', 'skills')));
    assert.ok(existsSync(path.join(box.project, '.agents', 'skills', 'dbaitest-scaffold', 'scripts', 'scaffold.mjs')));
    assert.match(result.stdout, /Commit these directories/);
    assert.ok(!existsSync(path.join(box.home, '.claude')), 'project install leaves home alone');
  });

  it('installs only for the chosen agent', () => {
    const box = sandbox();
    assert.equal(run(box, '--agent', 'codex').status, 0);
    assert.ok(existsSync(skill(box.project, '.agents', 'skills')));
    assert.ok(!existsSync(path.join(box.project, '.claude')));
  });

  it('installs into the home directory with --global', () => {
    const box = sandbox();
    const result = run(box, 'add', '--global');
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(skill(box.home, '.claude', 'skills')));
    assert.ok(existsSync(skill(box.home, '.agents', 'skills')));
    assert.ok(!existsSync(path.join(box.project, '.claude')));
  });

  it('is a no-op when the installed copy is identical', () => {
    const box = sandbox();
    run(box, 'add');
    const again = run(box, 'add');
    assert.equal(again.status, 0);
    assert.match(again.stdout, /up to date/);
  });

  it('refuses a changed copy without --force, and replaces it with --force', () => {
    const box = sandbox();
    run(box, 'add', '--agent', 'claude');
    const file = skill(box.project, '.claude', 'skills');
    appendFileSync(file, '\nlocal edit\n');

    const refused = run(box, 'add', '--agent', 'claude');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /--force/);
    assert.match(readFileSync(file, 'utf8'), /local edit/);

    const forced = run(box, 'add', '--agent', 'claude', '--force');
    assert.equal(forced.status, 0, forced.stderr);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /local edit/);
  });

  it('never overwrites a directory it did not install', () => {
    const box = sandbox();
    const foreign = path.join(box.project, '.claude', 'skills', 'dbaitest-scaffold');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(path.join(foreign, 'SKILL.md'), '---\nname: dbaitest-scaffold\ndescription: mine\n---\n');

    const result = run(box, 'add', '--agent', 'claude', '--force');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not installed by @dbaitest\/skills/);
    assert.match(readFileSync(path.join(foreign, 'SKILL.md'), 'utf8'), /description: mine/);
  });

  it('changes nothing with --dry-run', () => {
    const box = sandbox();
    const result = run(box, 'add', '--dry-run');
    assert.equal(result.status, 0);
    assert.match(result.stdout, /would install/);
    assert.ok(!existsSync(path.join(box.project, '.claude')));
  });

  it('exits 2 for bad arguments and creates nothing', () => {
    const box = sandbox();
    for (const args of [['add', 'no-such-skill'], ['add', '../x'], ['--agent', 'windsurf'], ['--agent', 'constructor'], ['--dir', 'missing/deep']]) {
      const result = run(box, ...args);
      assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, /\n\s+at /, 'no stack trace');
    }
    assert.ok(!existsSync(path.join(box.project, '.claude')));
    assert.ok(!existsSync(path.join(box.project, 'missing')));
  });

  it('reports the old and the new version when it replaces a copy', () => {
    const box = sandbox();
    run(box, 'add', '--agent', 'claude');
    const file = skill(box.project, '.claude', 'skills');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/dbaitest-version: "[^"]*"/, 'dbaitest-version: "0.0.1"'));

    const result = run(box, 'add', '--agent', 'claude', '--force');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /replaced .*\(DbAiTest 0\.0\.1 → \d+\.\d+\.\d+\)/);
  });

  it('changes no target when one of them refuses', () => {
    const box = sandbox();
    const foreign = path.join(box.project, '.claude', 'skills', 'dbaitest-scaffold');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(path.join(foreign, 'SKILL.md'), '---\nname: dbaitest-scaffold\ndescription: mine\n---\n');

    const result = run(box, 'add');
    assert.equal(result.status, 1);
    assert.ok(!existsSync(path.join(box.project, '.agents')), '.agents/skills was not written either');
  });

  it('treats a copy checked out with CRLF line endings (and OS junk files) as up to date', () => {
    const box = sandbox();
    run(box, 'add', '--agent', 'claude');
    const dir = path.join(box.project, '.claude', 'skills', 'dbaitest-scaffold');
    const file = path.join(dir, 'SKILL.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    writeFileSync(path.join(dir, 'Thumbs.db'), 'x');

    const result = run(box, 'add', '--agent', 'claude');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /up to date/);
  });

  it('accepts a SKILL.md saved with a byte-order mark as its own', () => {
    const box = sandbox();
    run(box, 'add', '--agent', 'claude');
    const file = skill(box.project, '.claude', 'skills');
    writeFileSync(file, `﻿${readFileSync(file, 'utf8')}`);
    assert.match(run(box, 'list').stdout, /dbaitest-scaffold/);
  });

  it('leaves no staging copy behind, and sweeps one left by a killed run', () => {
    const box = sandbox();
    const leftover = path.join(box.project, '.claude', '.dbaitest-skills-staging', 'dbaitest-scaffold-999', 'new');
    mkdirSync(leftover, { recursive: true });

    assert.equal(run(box, 'add', '--agent', 'claude').status, 0);
    assert.ok(!existsSync(path.join(box.project, '.claude', '.dbaitest-skills-staging')));
    assert.deepEqual(readdirSync(path.join(box.project, '.claude', 'skills')), ['dbaitest-scaffold']);
  });

  it('warns when git ignores the target, with advice that works', (t) => {
    const box = sandbox();
    if (spawnSync('git', ['init', '-q'], { cwd: box.project }).status !== 0) {
      t.skip('git is not installed');
      return;
    }
    writeFileSync(path.join(box.project, '.gitignore'), '.claude/\n');
    const result = run(box, 'add', '--agent', 'claude');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /warning: git ignores \.claude\/skills/);
    assert.match(result.stdout, /"\.claude\/\*" and add "!\.claude\/skills\/"/);

    writeFileSync(path.join(box.project, '.gitignore'), '.claude/*\n!.claude/skills/\n');
    const check = spawnSync('git', ['check-ignore', '-q', '.claude/skills/dbaitest-scaffold/SKILL.md'], { cwd: box.project });
    assert.equal(check.status, 1, 'the advised .gitignore lets git see the skill');
  });
});

describe('list and remove', () => {
  it('lists project and global installs, then removes only its own skills', () => {
    const box = sandbox();
    run(box, 'add', '--agent', 'claude');
    run(box, 'add', '--agent', 'codex', '--global');
    const foreign = path.join(box.project, '.claude', 'skills', 'someone-else');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(path.join(foreign, 'SKILL.md'), '---\nname: someone-else\ndescription: x\n---\n');

    const listed = run(box, 'list');
    assert.equal(listed.status, 0);
    assert.match(listed.stdout, /^project\s+dbaitest-scaffold\s+DbAiTest \d+\.\d+\.\d+/m);
    assert.match(listed.stdout, /^global\s+dbaitest-scaffold/m);
    assert.doesNotMatch(listed.stdout, /someone-else/);

    const removed = run(box, 'remove');
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!existsSync(path.join(box.project, '.claude', 'skills', 'dbaitest-scaffold')));
    assert.ok(existsSync(foreign), 'a skill it did not install stays');
    assert.ok(existsSync(skill(box.home, '.agents', 'skills')), 'project remove leaves global alone');
  });

  it('removes an edited copy only with --force, and --dry-run removes nothing', () => {
    const box = sandbox();
    run(box, 'add', '--agent', 'claude');
    const file = skill(box.project, '.claude', 'skills');
    appendFileSync(file, '\nlocal edit\n');

    const refused = run(box, 'remove');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /--force/);
    assert.ok(existsSync(file));

    assert.match(run(box, 'remove', '--force', '--dry-run').stdout, /would remove/);
    assert.ok(existsSync(file));

    assert.equal(run(box, 'remove', '--force').status, 0);
    assert.ok(!existsSync(file));
  });

  it('removes a named skill this version no longer ships, with --force', () => {
    const box = sandbox();
    const old = path.join(box.project, '.agents', 'skills', 'dbaitest-retired');
    mkdirSync(old, { recursive: true });
    writeFileSync(path.join(old, 'SKILL.md'), '---\nname: dbaitest-retired\ndescription: x\nmetadata:\n  source: "@dbaitest/skills"\n---\n');

    assert.equal(run(box, 'remove', 'dbaitest-retired').status, 1);
    assert.equal(run(box, 'remove', 'dbaitest-retired', '--force').status, 0);
    assert.ok(!existsSync(old));
  });

  it('lists each location once when run from the home directory', () => {
    const box = sandbox();
    run(box, 'add', '--agent', 'claude', '--global');
    const result = spawnSync(process.execPath, [bin, 'list'], {
      cwd: box.home,
      encoding: 'utf8',
      env: { ...process.env, HOME: box.home, USERPROFILE: box.home },
    });
    assert.equal(result.stdout.trim().split('\n').length, 1, result.stdout);
  });

  it('says so when nothing is installed', () => {
    const box = sandbox();
    assert.match(run(box, 'list').stdout, /No dbaitest skills installed/);
    assert.match(run(box, 'remove').stdout, /Nothing to remove/);
  });
});

describe('meta', () => {
  it('prints the package version and the usage', () => {
    const box = sandbox();
    const { version } = JSON.parse(readFileSync(path.resolve(path.dirname(bin), '../package.json'), 'utf8'));
    assert.equal(run(box, '--version').stdout.trim(), version);
    assert.match(run(box, '--help').stdout, /Usage: npx @dbaitest\/skills/);
  });
});
