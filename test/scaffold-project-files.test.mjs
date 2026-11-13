// Unit tests for the pure part of the scaffolder: which files it writes and what they say.
// Building and running the generated projects is CI's scaffold job; this suite needs no .NET.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { fill, projectFiles } from '../skills/dbaitest-scaffold/scripts/project-files-from-options.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/dbaitest-scaffold');
const versions = JSON.parse(readFileSync(path.join(skillRoot, 'versions.json'), 'utf8'));
const readTemplate = (relative) => readFileSync(path.join(skillRoot, 'templates', relative), 'utf8');

const scripts = (overrides = {}) => ({
  name: 'Shop.Database.Tests',
  engines: ['mssql', 'postgres', 'mysql'],
  schema: 'scripts',
  framework: 'net10.0',
  centralPackages: false,
  ...overrides,
});

const byPath = (files) => Object.fromEntries(files.map((f) => [f.path, f.content]));

describe('fill', () => {
  it('replaces every placeholder', () => {
    assert.equal(fill('{{A}}-{{B}}-{{A}}', { A: '1', B: '2' }), '1-2-1');
  });

  it('throws on a placeholder without a value', () => {
    assert.throws(() => fill('{{Missing}}', {}), /\{\{Missing\}\}/);
  });
});

describe('projectFiles (scripts)', () => {
  it('writes the project, the shared tests, one class and one schema per engine', () => {
    const files = byPath(projectFiles(scripts(), versions, readTemplate));

    assert.deepEqual(Object.keys(files).sort(), [
      'AssemblyInfo.cs',
      'CustomerTests.Engines.cs',
      'CustomerTests.cs',
      'Schema/mssql/001_tables.sql',
      'Schema/mysql/001_tables.sql',
      'Schema/postgres/001_tables.sql',
      'Shop.Database.Tests.csproj',
    ]);
    for (const content of Object.values(files)) {
      assert.doesNotMatch(content, /\{\{\w+\}\}/, 'no placeholder left behind');
    }
  });

  it('pins DbAiTest and the test packages to versions.json', () => {
    const csproj = byPath(projectFiles(scripts({ engines: ['postgres'] }), versions, readTemplate))['Shop.Database.Tests.csproj'];

    assert.match(csproj, new RegExp(`Include="DbAiTest.MSTest" Version="${versions.dbaitest}"`));
    assert.match(csproj, new RegExp(`Include="DbAiTest.PostgreSql" Version="${versions.dbaitest}"`));
    assert.match(csproj, new RegExp(`Include="MSTest" Version="${versions.packages.MSTest}"`));
    assert.doesNotMatch(csproj, /DbAiTest\.MsSql|DbAiTest\.MySql/);
    assert.match(csproj, /<None Include="Schema\\\*\*\\\*" CopyToOutputDirectory="PreserveNewest" \/>/);
  });

  it('leaves versions out under central package management', () => {
    const csproj = byPath(projectFiles(scripts({ centralPackages: true }), versions, readTemplate))['Shop.Database.Tests.csproj'];

    assert.doesNotMatch(csproj, /Version=/);
    assert.match(csproj, /<PackageReference Include="DbAiTest.MSTest" \/>/);
  });

  it('keeps the wiring DbAiTest needs', () => {
    const files = byPath(projectFiles(scripts(), versions, readTemplate));

    assert.match(files['AssemblyInfo.cs'], /\[assembly: DoNotParallelize\]/);
    assert.match(files['AssemblyInfo.cs'], /DbAiTestRun\.DisposeAllAsync\(\)/);
    assert.match(files['CustomerTests.cs'], /public abstract class CustomerTests : DbAiTestBase/);
    assert.match(files['CustomerTests.cs'], /namespace Shop\.Database\.Tests;/);
  });

  it('declares only the selected engines, with only their usings', () => {
    const engines = byPath(projectFiles(scripts({ engines: ['mysql'] }), versions, readTemplate))['CustomerTests.Engines.cs'];

    assert.match(engines, /class MySqlCustomerTests : CustomerTests/);
    assert.match(engines, /SchemaRoot => "Schema\/mysql"/);
    assert.doesNotMatch(engines, /MsSql|PostgreSql/);
    assert.match(engines, /^using DbAiTest\.MySql;\n/);
  });

  it('imports the harness types for every test file the agent adds', () => {
    const csproj = byPath(projectFiles(scripts(), versions, readTemplate))['Shop.Database.Tests.csproj'];
    assert.match(csproj, /<Using Include="DbAiTest\.Core\.Engine" \/>/);
    assert.match(csproj, /<Using Include="DbAiTest\.MSTest" \/>/);
  });
});

describe('projectFiles (dacpac)', () => {
  const dacpac = (extra) => scripts({ engines: ['mssql'], schema: 'dacpac', dacpacFileName: 'Shop.Database.dacpac', ...extra });

  it('references the database project and copies every dacpac to the output', () => {
    const files = byPath(projectFiles(dacpac({ sqlprojPath: '..\\Shop.Database\\Shop.Database.sqlproj' }), versions, readTemplate));

    assert.deepEqual(Object.keys(files).sort(), ['AssemblyInfo.cs', 'DatabaseTests.cs', 'Shop.Database.Tests.csproj']);
    const csproj = files['Shop.Database.Tests.csproj'];
    assert.match(csproj, /Include="DbAiTest.MsSql.Dacpac" Version=/);
    assert.match(csproj, /<ProjectReference Include="\.\.\\Shop\.Database\\Shop\.Database\.sqlproj"/);
    assert.match(csproj, /ReferenceOutputAssembly="false"/);
    assert.match(csproj, /<Target Name="CopyDacpacs" AfterTargets="Build">/);
    assert.match(files['DatabaseTests.cs'], /new DacpacSchemaSource\(Path\.Join\(AppContext\.BaseDirectory, "Shop\.Database\.dacpac"\)\)/);
  });

  it('copies a prebuilt dacpac and its neighbours instead', () => {
    const csproj = byPath(projectFiles(dacpac({ dacpacPath: { directory: '..\\db' } }), versions, readTemplate))['Shop.Database.Tests.csproj'];

    assert.match(csproj, /<None Include="\.\.\\db\\\*\.dacpac" Link="%\(Filename\)%\(Extension\)" CopyToOutputDirectory="PreserveNewest" \/>/);
    assert.doesNotMatch(csproj, /ProjectReference|CopyDacpacs/);
  });
});
