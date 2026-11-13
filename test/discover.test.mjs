// Discovery: the pure rules on their own, then the whole scan against fixture repositories that
// look like real projects (test/fixtures/repos).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { discover } from '../skills/dbaitest-scaffold/scripts/discover.mjs';
import {
  dialectOf,
  dialectScores,
  enginesFromConfigText,
  enginesFromProjectFile,
  isTestProject,
} from '../skills/dbaitest-scaffold/scripts/repository-signals.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures', 'repos');
const script = path.join(here, '..', 'skills', 'dbaitest-scaffold', 'scripts', 'discover.mjs');
const noSdk = { sdkVersion: () => null };

describe('repository signals', () => {
  it('maps packages to engines', () => {
    const engines = (pkg) => enginesFromProjectFile(`<PackageReference Include="${pkg}" Version="1" />`).map((e) => e.engine);
    assert.deepEqual(engines('Microsoft.Data.SqlClient'), ['mssql']);
    assert.deepEqual(engines('Microsoft.EntityFrameworkCore.SqlServer'), ['mssql']);
    assert.deepEqual(engines('Npgsql.EntityFrameworkCore.PostgreSQL'), ['postgres']);
    assert.deepEqual(engines('Pomelo.EntityFrameworkCore.MySql'), ['mysql']);
    assert.deepEqual(engines('MySqlConnector'), ['mysql']);
    assert.deepEqual(engines('Dapper'), []);
  });

  it('maps hosting, migration and test-container packages, and engines DbAiTest does not support', () => {
    const engines = (pkg) => enginesFromProjectFile(`<PackageReference Include="${pkg}" Version="1" />`).map((e) => e.engine);
    assert.deepEqual(engines('Aspire.Hosting.PostgreSQL'), ['postgres']);
    assert.deepEqual(engines('Microsoft.EntityFrameworkCore.SqlServer.NetTopologySuite'), ['mssql']);
    assert.deepEqual(engines('dbup-mysql'), ['mysql']);
    assert.deepEqual(engines('Testcontainers.MsSql'), ['mssql']);
    assert.deepEqual(engines('Microsoft.EntityFrameworkCore.Sqlite'), ['sqlite']);
    assert.deepEqual(engines('Oracle.ManagedDataAccess.Core'), ['oracle']);
  });

  it('reads connection strings and container images', () => {
    const engines = (text) => [...new Set(enginesFromConfigText(text).map((e) => e.engine))];
    assert.deepEqual(engines('"Server=.;Database=x;Trusted_Connection=True"'), ['mssql']);
    assert.deepEqual(engines('"Host=db;Port=5432;Database=x;Username=y"'), ['postgres']);
    assert.deepEqual(engines('image: postgres:17'), ['postgres']);
    assert.deepEqual(engines('image: bitnami/postgresql:16'), ['postgres']);
    assert.deepEqual(engines('image: pgvector/pgvector:pg16'), ['postgres']);
    assert.deepEqual(engines('image: mysql:8.4'), ['mysql']);
    assert.deepEqual(engines('image: mcr.microsoft.com/mssql/server:2022-latest'), ['mssql']);
    assert.deepEqual(engines('"Server=db;Database=x;User Id=a;Password=b"'), [], 'ambiguous strings are not evidence');
  });

  it('does not take SQLite, Oracle or a shared keyword for SQL Server', () => {
    const engines = (text) => [...new Set(enginesFromConfigText(text).map((e) => e.engine))];
    assert.deepEqual(engines('"Data Source=app.db;Cache=Shared"'), ['sqlite']);
    assert.deepEqual(engines('"Data Source=ORCL;User Id=a;Password=b"'), []);
    assert.deepEqual(engines('"Host=db;Database=x;Username=y;TrustServerCertificate=true"'), ['postgres']);
  });

  it('never repeats a password in its evidence', () => {
    const evidence = enginesFromConfigText('"Host=db;Username=app;Password=Sup3rS3cret!;Database=billing"');
    assert.ok(evidence.length > 0);
    assert.ok(evidence.every((e) => !e.signal.includes('Sup3rS3cret') && !/password/i.test(e.signal)), JSON.stringify(evidence));
  });

  it('recognises test projects', () => {
    assert.equal(isTestProject('<PackageReference Include="MSTest" Version="4" />'), true);
    assert.equal(isTestProject('<PackageReference Include="xunit.v3" Version="1" />'), true);
    assert.equal(isTestProject('<Project Sdk="MSTest.Sdk/3.6.0">'), true);
    assert.equal(isTestProject('<PackageReference Include="Npgsql" Version="10" />'), false);
  });

  it('tells the three dialects apart and refuses to guess on plain SQL', () => {
    assert.equal(dialectOf(dialectScores('CREATE TABLE t (id SERIAL PRIMARY KEY, n TEXT);')), 'postgres');
    assert.equal(dialectOf(dialectScores('CREATE TABLE dbo.t (id INT IDENTITY(1,1));\nGO\n')), 'mssql');
    assert.equal(dialectOf(dialectScores('CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END; $$;')), 'postgres');
    assert.equal(dialectOf(dialectScores('DELIMITER //\nCREATE TABLE t (id INT AUTO_INCREMENT) ENGINE=InnoDB //')), 'mysql');
    assert.equal(dialectOf(dialectScores('CREATE TABLE t (id INT PRIMARY KEY);')), null);
  });
});

describe('discover on fixture repositories', () => {
  it('finds the SDK-style database project of a SQL Server app', () => {
    const report = discover(path.join(fixtures, 'sqlproj-shop'), noSdk);
    assert.equal(report.engine, 'mssql');
    assert.deepEqual(report.sqlprojs.map((p) => [p.path, p.sdkStyle, p.dacpacName]), [
      ['database/Shop.Database/Shop.Database.sqlproj', true, 'Shop.Database.dacpac'],
    ]);
    assert.deepEqual(report.scriptFolders, [], 'scripts inside the database project are not a separate folder');
    const signals = report.engines[0].evidence.map((e) => e.file);
    assert.ok(signals.includes('src/Shop.Api/Shop.Api.csproj') && signals.includes('src/Shop.Api/appsettings.json'));
  });

  it('points a PostgreSQL app at its schema folder, beside the seed data', () => {
    const report = discover(path.join(fixtures, 'scripts-postgres'), noSdk);
    assert.equal(report.engine, 'postgres');
    const [folder] = report.scriptFolders;
    assert.equal(report.scriptFolders.length, 1, 'the .sql file inside the test project is ignored');
    assert.equal(folder.path, 'db');
    assert.equal(folder.dialect, 'postgres');
    assert.deepEqual(folder.suggestedExclusions, ['seed']);
    assert.equal(folder.schemaDir, 'db/schema');
    assert.deepEqual(folder.excludeFromSchemaDir, []);
    assert.equal(report.testsFolder, 'tests');
  });

  it('reads a MySQL app from its package and its compose file', () => {
    const report = discover(path.join(fixtures, 'scripts-mysql'), noSdk);
    assert.equal(report.engine, 'mysql');
    assert.deepEqual(report.scriptFolders.map((f) => [f.path, f.dialect, f.schemaDir]), [['database', 'mysql', 'database']]);
    assert.ok(report.engines[0].evidence.some((e) => e.file === 'docker-compose.yml'));
  });

  it('recognises GO-separated SQL Server scripts without a database project', () => {
    const report = discover(path.join(fixtures, 'scripts-mssql'), noSdk);
    assert.equal(report.engine, 'mssql');
    assert.deepEqual(report.sqlprojs, []);
    assert.deepEqual(report.scriptFolders.map((f) => [f.path, f.dialect]), [['sql', 'mssql']]);
  });

  it('reports nothing for an app without a database', () => {
    const report = discover(path.join(fixtures, 'empty'), noSdk);
    assert.equal(report.engine, null);
    assert.deepEqual([report.engines, report.sqlprojs, report.scriptFolders], [[], [], []]);
  });
});

describe('discover on edge cases', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dbaitest-discover-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  const repo = (name, files) => {
    const dir = path.join(root, name);
    for (const [relative, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
      writeFileSync(path.join(dir, relative), content);
    }
    return dir;
  };

  it('leaves the engine open when the repository uses two', () => {
    const dir = repo('two', {
      'a/A.csproj': '<PackageReference Include="Npgsql" Version="1" />',
      'b/B.csproj': '<PackageReference Include="MySqlConnector" Version="1" />',
    });
    const report = discover(dir, noSdk);
    assert.equal(report.engine, null);
    assert.deepEqual(report.engines.map((e) => e.engine).sort(), ['mysql', 'postgres']);
  });

  it('skips build output and agent folders, and reports a classic project with its built dacpac', () => {
    const dir = repo('classic', {
      'Db/Db.sqlproj': '<Project ToolsVersion="4.0"><Import Project="Microsoft.Data.Tools.Schema.SqlTasks.targets" /></Project>',
      'Db/bin/Release/Db.dacpac': '',
      'App/bin/Debug/stale.sql': 'CREATE TABLE x (id INT);',
      '.claude/skills/s/x.sql': 'CREATE TABLE y (id INT);',
    });
    const report = discover(dir, noSdk);
    assert.deepEqual(report.sqlprojs, [{ path: 'Db/Db.sqlproj', sdkStyle: false, dacpacName: 'Db.dacpac', builtDacpacs: ['Db/bin/Release/Db.dacpac'] }]);
    assert.deepEqual(report.scriptFolders, []);
  });

  it('reports an engine DbAiTest does not support and leaves the engine open', () => {
    const dir = repo('sqlite', {
      'App/App.csproj': '<PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="9" />',
      'App/appsettings.json': '{ "ConnectionStrings": { "Db": "Data Source=app.db" } }',
    });
    const report = discover(dir, noSdk);
    assert.equal(report.engine, null);
    assert.deepEqual(report.engines, []);
    assert.deepEqual(report.unsupported.map((e) => e.engine), ['sqlite']);
  });

  it('is confident only with a package or a database project behind the engine', () => {
    const configOnly = discover(repo('config-only', { 'appsettings.json': '"Host=db;Database=x"' }), noSdk);
    assert.equal(configOnly.engine, 'postgres');
    assert.equal(configOnly.confident, false);
    assert.equal(discover(path.join(fixtures, 'scripts-postgres'), noSdk).confident, true);
  });

  it('never suggests the repository root as the schema folder', () => {
    const report = discover(repo('root-sql', { 'schema.sql': 'CREATE TABLE t (id SERIAL);' }), noSdk);
    assert.equal(report.scriptFolders.length, 1);
    assert.equal(report.scriptFolders[0].schemaDir, null);
  });

  it('splits engine folders and flags separate databases under one schema folder', () => {
    const engines = discover(repo('per-engine', {
      'sql/postgres/1.sql': 'CREATE TABLE t (id SERIAL); CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;',
      'sql/mssql/1.sql': 'CREATE TABLE dbo.t (id INT IDENTITY(1,1));\nGO\n',
    }), noSdk);
    assert.deepEqual(engines.scriptFolders.map((f) => [f.path, f.dialect]).sort(), [['sql/mssql', 'mssql'], ['sql/postgres', 'postgres']]);

    const two = discover(repo('two-databases', {
      'database/Billing/1.sql': 'CREATE TABLE invoices (id SERIAL);',
      'database/Shop/1.sql': 'CREATE TABLE orders (id SERIAL);',
    }), noSdk);
    assert.deepEqual(two.scriptFolders[0].possibleSeparateDatabases, ['Billing', 'Shop']);

    const layered = discover(repo('object-folders', {
      'database/tables/1.sql': 'CREATE TABLE a (id SERIAL);',
      'database/views/1.sql': 'CREATE VIEW v AS SELECT 1;',
    }), noSdk);
    assert.deepEqual(layered.scriptFolders[0].possibleSeparateDatabases, []);
  });

  it('flags versioned migrations and leaves migrations out beside a schema folder', () => {
    const flyway = discover(repo('flyway', { 'db/V1__init.sql': 'CREATE TABLE t (id SERIAL);', 'db/V10__more.sql': 'ALTER TABLE t ADD n INT;' }), noSdk);
    assert.equal(flyway.scriptFolders[0].versionedMigrations, true);

    const both = discover(repo('schema-and-migrations', {
      'db/schema/1.sql': 'CREATE TABLE t (id SERIAL);',
      'db/migrations/2.sql': 'ALTER TABLE t ADD n INT;',
      'db/seed/3.sql': 'INSERT INTO t DEFAULT VALUES;',
    }), noSdk);
    assert.deepEqual(both.scriptFolders[0].suggestedExclusions, ['migrations', 'seed']);
    assert.equal(both.scriptFolders[0].schemaDir, 'db/schema');
  });

  it('is not blinded by thousands of unrelated files', () => {
    const files = { 'src/App/App.csproj': '<PackageReference Include="Npgsql" Version="1" />', 'db/a.sql': 'CREATE TABLE t (id SERIAL);' };
    for (let i = 0; i < 300; i++) files[`assets/img${i}.png`] = '';
    const report = discover(repo('assets', files), noSdk);
    assert.equal(report.engine, 'postgres');
    assert.equal(report.truncated, false);
  });

  it('runs as a command and prints JSON', () => {
    const result = spawnSync(process.execPath, [script, '--root', path.join(fixtures, 'scripts-mysql')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).engine, 'mysql');
    assert.equal(spawnSync(process.execPath, [script, '--root', path.join(root, 'missing')]).status, 2);
  });
});
