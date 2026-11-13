// End-to-end tests of scaffold.mjs as an agent runs it: exit codes, where files land, and what
// the dacpac options write. Building the generated projects is CI's job (needs .NET + Docker).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/dbaitest-scaffold/scripts/scaffold.mjs');
const root = mkdtempSync(path.join(os.tmpdir(), 'dbaitest-cli-'));
after(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
function workspace() {
  const dir = path.join(root, `w${++counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function scaffold(cwd, ...args) {
  return spawnSync(process.execPath, [script, '--framework', 'net10.0', ...args], { cwd, encoding: 'utf8' });
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

const SDK_SQLPROJ = '<Project Sdk="Microsoft.Build.Sql"><PropertyGroup><Name>Shop.Database</Name></PropertyGroup></Project>';

describe('exit codes', () => {
  const usage = [
    ['an unknown option', ['--name', 'A.B', '--nope']],
    ['a positional argument', ['--name', 'A.B', 'extra']],
    ['a name that is not a namespace', ['--name', '1bad']],
    ['no --engines for scripts', ['--name', 'A.B']],
    ['an empty --engines', ['--name', 'A.B', '--engines', '']],
    ['--schema-dir with two engines', ['--name', 'A.B', '--engines', 'mssql,postgres', '--schema-dir', '.']],
    ['--schema-dir without .sql files', ['--name', 'A.B', '--engines', 'postgres', '--schema-dir', '.']],
    ['--exclude-dir without --schema-dir', ['--name', 'A.B', '--engines', 'postgres', '--exclude-dir', 'seed']],
    ['--schema-dir with dacpac', ['--name', 'A.B', '--schema', 'dacpac', '--dacpac', 'x.dacpac', '--schema-dir', '.']],
    ['an unknown engine', ['--name', 'A.B', '--engines', 'oracle']],
    ['dacpac without a source', ['--name', 'A.B', '--schema', 'dacpac']],
    ['dacpac on postgres', ['--name', 'A.B', '--schema', 'dacpac', '--engines', 'postgres', '--dacpac', 'x.dacpac']],
    ['--sqlproj without dacpac', ['--name', 'A.B', '--sqlproj', 'x.sqlproj']],
    ['a --dacpac that does not exist', ['--name', 'A.B', '--schema', 'dacpac', '--dacpac', 'missing.dacpac']],
  ];
  for (const [what, args] of usage) {
    it(`exits 2 for ${what}`, () => {
      const result = scaffold(workspace(), ...args);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /^error: /);
    });
  }

  it('exits 2 for both --sqlproj and --dacpac', () => {
    const cwd = workspace();
    writeFileSync(path.join(cwd, 'Shop.sqlproj'), SDK_SQLPROJ);
    writeFileSync(path.join(cwd, 'Shop.dacpac'), '');
    const result = scaffold(cwd, '--name', 'A.B', '--schema', 'dacpac', '--sqlproj', 'Shop.sqlproj', '--dacpac', 'Shop.dacpac');
    assert.equal(result.status, 2);
  });

  it('exits 2 for a classic SSDT project, pointing at --dacpac', () => {
    const cwd = workspace();
    writeFileSync(path.join(cwd, 'Old.sqlproj'), '<Project ToolsVersion="4.0"><Import Project="Microsoft.Data.Tools.Schema.SqlTasks.targets" /></Project>');
    const result = scaffold(cwd, '--name', 'A.B', '--schema', 'dacpac', '--sqlproj', 'Old.sqlproj');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /classic .*--dacpac/s);
  });

  it('exits 1 for a non-empty directory without --force, and writes with it', () => {
    const cwd = workspace();
    mkdirSync(path.join(cwd, 'X'));
    writeFileSync(path.join(cwd, 'X', 'keep.txt'), 'mine');
    assert.equal(scaffold(cwd, '--name', 'A.B', '--engines', 'postgres', '--dir', 'X').status, 1);
    assert.equal(scaffold(cwd, '--name', 'A.B', '--engines', 'postgres', '--dir', 'X', '--force').status, 0);
    assert.equal(readFileSync(path.join(cwd, 'X', 'keep.txt'), 'utf8'), 'mine');
  });

  it('exits 1 cleanly when --dir is a file', () => {
    const cwd = workspace();
    writeFileSync(path.join(cwd, 'X'), '');
    const result = scaffold(cwd, '--name', 'A.B', '--engines', 'postgres', '--dir', 'X');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a directory/);
  });
});

describe('output', () => {
  it('resolves --dir against the current directory and writes LF-only files', () => {
    const cwd = workspace();
    const result = scaffold(cwd, '--name', 'Shop.Database.Tests', '--dir', 'tests/Shop.Database.Tests', '--engines', 'MSSQL,mssql');
    assert.equal(result.status, 0, result.stderr);

    const dir = path.join(cwd, 'tests', 'Shop.Database.Tests');
    assert.ok(existsSync(path.join(dir, 'Shop.Database.Tests.csproj')));
    assert.ok(existsSync(path.join(dir, 'Schema', 'mssql', '001_tables.sql')));
    assert.ok(!existsSync(path.join(dir, 'Schema', 'postgres')), 'duplicate and upper-case engines collapse to mssql');
    for (const file of filesUnder(dir)) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /\r/, `${file} has CR`);
    }
  });

  it('references an SDK-style database project relatively and derives the dacpac name', () => {
    const cwd = workspace();
    mkdirSync(path.join(cwd, 'db'));
    writeFileSync(path.join(cwd, 'db', 'Shop.Database.sqlproj'), SDK_SQLPROJ);
    const result = scaffold(cwd, '--name', 'Shop.Tests', '--dir', 'tests/Shop.Tests', '--schema', 'dacpac', '--sqlproj', 'db/Shop.Database.sqlproj');
    assert.equal(result.status, 0, result.stderr);

    const dir = path.join(cwd, 'tests', 'Shop.Tests');
    assert.match(readFileSync(path.join(dir, 'Shop.Tests.csproj'), 'utf8'), /<ProjectReference Include="\.\.\\\.\.\\db\\Shop\.Database\.sqlproj"/);
    const tests = readFileSync(path.join(dir, 'DatabaseTests.cs'), 'utf8');
    assert.match(tests, /"Shop\.Database\.dacpac"/);
    assert.doesNotMatch(tests, /\{\{\w+\}\}/);
  });

  it('keeps the case of a prebuilt dacpac and escapes its folder', () => {
    const cwd = workspace();
    mkdirSync(path.join(cwd, 'R&D'));
    writeFileSync(path.join(cwd, 'R&D', 'Shop.DACPAC'), '');
    const result = scaffold(cwd, '--name', 'Shop.Tests', '--schema', 'dacpac', '--dacpac', 'R&D/Shop.DACPAC');
    assert.equal(result.status, 0, result.stderr);

    const dir = path.join(cwd, 'Shop.Tests');
    assert.match(readFileSync(path.join(dir, 'DatabaseTests.cs'), 'utf8'), /"Shop\.DACPAC"/);
    assert.match(readFileSync(path.join(dir, 'Shop.Tests.csproj'), 'utf8'), /<None Include="\.\.\\R&amp;D\\\*\.dacpac"/);
  });

  it('prints the PackageVersion lines under central package management', () => {
    const cwd = workspace();
    writeFileSync(path.join(cwd, 'Directory.Packages.props'), '<Project><PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally></PropertyGroup></Project>');
    const result = scaffold(cwd, '--name', 'A.B', '--engines', 'postgres');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /<PackageVersion Include="DbAiTest\.PostgreSql" Version="\d+\.\d+\.\d+" \/>/);
    assert.doesNotMatch(readFileSync(path.join(cwd, 'A.B', 'A.B.csproj'), 'utf8'), /Version=/);
  });
});

describe('existing schema folders', () => {
  const fixtures = path.resolve(path.dirname(script), '../../../test/fixtures/repos');

  it('links the folder instead of writing a starter schema, with a smoke-test suite', () => {
    const cwd = path.join(fixtures, 'scripts-postgres');
    const dir = path.join(workspace(), 'Billing.Database.Tests');
    const result = scaffold(cwd, '--name', 'Billing.Database.Tests', '--dir', dir, '--engines', 'postgres', '--schema-dir', 'db/schema');
    assert.equal(result.status, 0, result.stderr);

    const csproj = readFileSync(path.join(dir, 'Billing.Database.Tests.csproj'), 'utf8');
    const linked = /<None Include="([^"]*)"/.exec(csproj)[1].split(';');
    assert.equal(linked.length, 2, linked.join(';'));
    assert.ok(linked[0].endsWith(String.raw`db\schema\**\*.sql`), linked[0]);
    assert.ok(linked[1].endsWith(String.raw`db\schema\**\*.psql`), linked[1]);
    assert.ok(csproj.includes(String.raw`LinkBase="Schema\postgres"`), csproj);
    assert.ok(!existsSync(path.join(dir, 'Schema')), 'no starter schema');
    assert.match(readFileSync(path.join(dir, 'DatabaseTests.cs'), 'utf8'), /public abstract class DatabaseTests : DbAiTestBase/);
    const engines = readFileSync(path.join(dir, 'DatabaseTests.Engines.cs'), 'utf8');
    assert.match(engines, /class PostgreSqlDatabaseTests : DatabaseTests/);
    assert.doesNotMatch(engines, /SchemaLoadOptions/);
  });

  it('writes SchemaLoadOptions for excluded folders', () => {
    const cwd = path.join(fixtures, 'scripts-postgres');
    const dir = path.join(workspace(), 'Billing.Database.Tests');
    const result = scaffold(cwd, '--name', 'Billing.Database.Tests', '--dir', dir, '--engines', 'postgres', '--schema-dir', 'db', '--exclude-dir', 'seed');
    assert.equal(result.status, 0, result.stderr);

    const engines = readFileSync(path.join(dir, 'DatabaseTests.Engines.cs'), 'utf8');
    assert.match(engines, /using DbAiTest\.Core\.Schema;/);
    assert.match(engines, /ExcludedDirectories = \["seed"\]/);
  });

  it('rejects an exclusion that is a path', () => {
    const cwd = path.join(fixtures, 'scripts-postgres');
    const result = scaffold(cwd, '--name', 'A.B', '--dir', path.join(workspace(), 'X'), '--engines', 'postgres', '--schema-dir', 'db', '--exclude-dir', 'seed/x');
    assert.equal(result.status, 2);
  });
});
