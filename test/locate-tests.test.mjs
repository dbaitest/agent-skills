// The locate script: the pure rules on their own, then the whole scan over a temporary
// repository that holds a DbAiTest test project, written the way the scaffolder writes it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { locate } from '../skills/dbaitest-add-test/scripts/locate-tests.mjs';
import {
  dbaitestPackages,
  isDbAiTestProject,
  parseTestClasses,
  projectInfo,
  schemaSourceOf,
  testLayout,
} from '../skills/dbaitest-add-test/scripts/test-project-signals.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'skills', 'dbaitest-add-test', 'scripts', 'locate-tests.mjs');
const root = mkdtempSync(path.join(os.tmpdir(), 'dbaitest-locate-'));
after(() => rmSync(root, { recursive: true, force: true }));

const SCRIPTS_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <RootNamespace>Shop.Database.Tests</RootNamespace>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="18.11.0" />
    <PackageReference Include="DbAiTest.MSTest" Version="0.4.0" />
    <PackageReference Include="DbAiTest.PostgreSql" Version="0.4.0" />
  </ItemGroup>
  <ItemGroup>
    <None Include="..\\..\\db\\schema\\**\\*.sql" LinkBase="Schema\\postgres" CopyToOutputDirectory="PreserveNewest" />
  </ItemGroup>
</Project>`;

const DACPAC_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net8.0;net10.0</TargetFrameworks>
    <RootNamespace>Shop.Database.Tests</RootNamespace>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="DbAiTest.MSTest" Version="0.4.0" />
    <PackageReference Include="DbAiTest.MsSql.Dacpac" Version="0.4.0" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\\..\\database\\Shop.Database\\Shop.Database.sqlproj" ReferenceOutputAssembly="false" />
  </ItemGroup>
</Project>`;

const DATABASE_TESTS = `namespace Shop.Database.Tests;

public abstract partial class DatabaseTests : DbAiTestBase
{
    [TestInitialize]
    public async Task ResetAsync()
    {
        await Harness.CleanAsync(TestContext.CancellationToken);
    }

    [TestMethod]
    public async Task Schema_Applies_And_Creates_Objects()
    {
        var objects = await Harness.ListObjectsAsync(TestContext.CancellationToken);
        Assert.IsNotEmpty(objects);
    }
}
`;

const ENGINE_TESTS = `using DbAiTest.PostgreSql;

namespace Shop.Database.Tests;

[TestClass]
public sealed class PostgreSqlDatabaseTests : DatabaseTests
{
    protected override DbEngine CreateEngine() => new PostgreSqlEngine();

    protected override string? SchemaRoot => "Schema/postgres";
}
`;

/** A repository with a DbAiTest test project, the way the scaffolder leaves it. */
function repositoryWith(name = 'Shop.Database.Tests') {
  const dir = path.join(root, `repo-${Math.random().toString(36).slice(2)}`);
  const project = path.join(dir, 'tests', name);
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, `${name}.csproj`), SCRIPTS_CSPROJ, 'utf8');
  writeFileSync(path.join(project, 'DatabaseTests.cs'), DATABASE_TESTS, 'utf8');
  writeFileSync(path.join(project, 'DatabaseTests.Engines.cs'), ENGINE_TESTS, 'utf8');
  return dir;
}

describe('project signals', () => {
  it('recognises a DbAiTest test project', () => {
    assert.equal(isDbAiTestProject(SCRIPTS_CSPROJ), true);
    assert.equal(isDbAiTestProject(DACPAC_CSPROJ), true);
    assert.equal(isDbAiTestProject('<Project Sdk="Microsoft.NET.Sdk"></Project>'), false);
  });

  it('does not mistake a project that only uses the libraries for a test project', () => {
    const library = '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="DbAiTest.MsSql" Version="0.4.0" /></ItemGroup></Project>';
    assert.equal(isDbAiTestProject(library), false);
    assert.deepEqual(dbaitestPackages(library), ['DbAiTest.MsSql']);
  });

  it('reads the name, the namespace, the framework and the packages', () => {
    assert.deepEqual(projectInfo(SCRIPTS_CSPROJ, 'Shop.Database.Tests.csproj'), {
      name: 'Shop.Database.Tests',
      rootNamespace: 'Shop.Database.Tests',
      frameworks: ['net10.0'],
      packages: ['DbAiTest.MSTest', 'DbAiTest.PostgreSql'],
    });
    assert.deepEqual(projectInfo(DACPAC_CSPROJ, 'x.csproj').frameworks, ['net8.0', 'net10.0']);
    assert.equal(projectInfo('<Project />', 'Billing.Database.Tests.csproj').name, 'Billing.Database.Tests');
  });

  it('tells a linked script folder from a database project', () => {
    assert.deepEqual(schemaSourceOf(SCRIPTS_CSPROJ), {
      kind: 'scripts',
      roots: ['Schema/postgres'],
      dacpacs: [],
      includes: ['..\\..\\db\\schema\\**\\*.sql'],
    });
    assert.equal(schemaSourceOf(DACPAC_CSPROJ).kind, 'dacpac');
    assert.deepEqual(schemaSourceOf(DACPAC_CSPROJ).dacpacs, ['Shop.Database.sqlproj']);
    assert.equal(schemaSourceOf('<Project />').kind, 'none');
  });

  it('sees a script folder that is linked without a link base', () => {
    const linked = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <None Include="..\\..\\db\\**\\*.sql" CopyToOutputDirectory="PreserveNewest" />
  </ItemGroup>
</Project>`;
    assert.equal(schemaSourceOf(linked).kind, 'scripts');
    assert.deepEqual(schemaSourceOf(linked).roots, []);
    assert.deepEqual(schemaSourceOf(linked).includes, ['..\\..\\db\\**\\*.sql']);
  });

  it('sees the schema folder the scaffolder writes into the project', () => {
    const starter = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <None Include="Schema\\**\\*" CopyToOutputDirectory="PreserveNewest" />
  </ItemGroup>
</Project>`;
    assert.equal(schemaSourceOf(starter).kind, 'scripts');
    assert.deepEqual(schemaSourceOf(starter).includes, ['Schema\\**\\*']);
  });

  it('keeps the patterns of an include apart', () => {
    const both = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <None Include="..\\db\\**\\*.sql;..\\db\\**\\*.psql" LinkBase="Schema\\postgres" />
  </ItemGroup>
</Project>`;
    assert.deepEqual(schemaSourceOf(both).includes, ['..\\db\\**\\*.sql', '..\\db\\**\\*.psql']);
    assert.deepEqual(schemaSourceOf(both).roots, ['Schema/postgres']);
  });

  it('reads a target framework that carries a condition', () => {
    const conditional = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework Condition=" \'$(OS)\' == \'Windows_NT\' ">net8.0</TargetFramework></PropertyGroup></Project>';
    assert.deepEqual(projectInfo(conditional, 'x.csproj').frameworks, ['net8.0']);
  });

  it('reads the abstract class, the class per engine and the tests', () => {
    const classes = [...parseTestClasses(DATABASE_TESTS), ...parseTestClasses(ENGINE_TESTS)];
    const layout = testLayout(classes);
    assert.equal(layout.baseTestClass.name, 'DatabaseTests');
    assert.equal(layout.baseTestClass.isAbstract, true);
    assert.deepEqual(layout.baseTestClass.initializeMethods, ['ResetAsync']);
    assert.deepEqual(layout.engineClasses, [{
      name: 'PostgreSqlDatabaseTests',
      engine: 'postgres',
      schemaRoot: 'Schema/postgres',
      suite: 'DatabaseTests',
      excludedDirectories: [],
      excludedFileNamePatterns: [],
      orderedDirectories: [],
    }]);
    assert.deepEqual(layout.testMethods, [{ name: 'Schema_Applies_And_Creates_Objects', class: 'DatabaseTests' }]);
  });

  it('does not mistake another class for an engine class', () => {
    const classes = parseTestClasses(`
namespace Shop.Database.Tests;

public class Helper
{
    public int Value => 1;
}
`);
    assert.deepEqual(testLayout(classes).baseTestClass, null);
    assert.deepEqual(testLayout(classes).engineClasses, []);
  });

  it('reports every suite of a project that has two of them', () => {
    const classes = parseTestClasses(`
namespace Shop.Database.Tests;

public abstract class BillingTests : DbAiTestBase { }

public abstract class ShippingTests : DbAiTestBase { }
`);
    const engines = parseTestClasses(`
namespace Shop.Database.Tests;

public sealed class MsSqlBillingTests : BillingTests
{
    protected override DbEngine CreateEngine() => new MsSqlEngine();
}

public sealed class PostgreSqlShippingTests : ShippingTests
{
    protected override DbEngine CreateEngine() => new PostgreSqlEngine();
}
`);
    const layout = testLayout([...classes, ...engines]);
    assert.deepEqual(layout.testClasses.map((c) => c.name), ['BillingTests', 'ShippingTests']);
    assert.deepEqual(layout.engineClasses.map((c) => [c.name, c.engine, c.suite]), [
      ['MsSqlBillingTests', 'mssql', 'BillingTests'],
      ['PostgreSqlShippingTests', 'postgres', 'ShippingTests'],
    ]);
  });

  it('reads a test class that is generic', () => {
    const layout = testLayout(parseTestClasses(`
namespace Shop.Database.Tests;

public abstract class DatabaseTests<TFixture> : DbAiTestBase
{
    [TestMethod]
    public async Task Works() { }
}
`));
    assert.equal(layout.baseTestClass.name, 'DatabaseTests');
    assert.deepEqual(layout.testMethods.map((m) => m.name), ['Works']);
  });

  it('reads the folders the harness skips and the order it applies', () => {
    const classes = parseTestClasses(`namespace Shop.Database.Tests;

[TestClass]
public sealed class PostgreSqlDatabaseTests : DatabaseTests
{
    protected override DbEngine CreateEngine() => new PostgreSqlEngine();

    protected override string? SchemaRoot => "Schema/postgres";

    protected override SchemaLoadOptions? SchemaLoadOptions => new()
    {
        ExcludedDirectories = ["seed", "maintenance"],
    };
}
`);
    const layout = testLayout([...parseTestClasses(DATABASE_TESTS), ...classes]);
    assert.deepEqual(layout.engineClasses[0].excludedDirectories, ['seed', 'maintenance']);
    assert.deepEqual(layout.engineClasses[0].orderedDirectories, []);
  });

  it('reads a project that deploys a dacpac from its own test class', () => {
    const classes = parseTestClasses(`namespace Shop.Database.Tests;

[TestClass]
public sealed partial class DatabaseTests : DbAiTestBase
{
    protected override DbEngine CreateEngine() => new MsSqlEngine();

    protected override SchemaSource? SchemaSource =>
        new DacpacSchemaSource(Path.Join(AppContext.BaseDirectory, "Shop.Database.dacpac"));
}
`);
    const layout = testLayout(classes);
    assert.equal(layout.baseTestClass.name, 'DatabaseTests');
    assert.equal(layout.baseTestClass.isAbstract, false);
    assert.equal(layout.baseTestClass.engine, 'mssql');
    assert.equal(layout.baseTestClass.schemaSource, 'DacpacSchemaSource');
    assert.deepEqual(layout.engineClasses, []);
    assert.deepEqual(layout.testClasses.map((c) => c.name), ['DatabaseTests']);
  });
});

describe('locate on a repository', () => {
  it('finds the test project and says what is in it', () => {
    const report = locate(repositoryWith());
    assert.equal(report.testProjects.length, 1);
    const project = report.testProjects[0];
    assert.equal(project.name, 'Shop.Database.Tests');
    assert.equal(project.rootNamespace, 'Shop.Database.Tests');
    assert.deepEqual(project.frameworks, ['net10.0']);
    assert.equal(project.schema.kind, 'scripts');
    assert.deepEqual(project.schema.roots, ['Schema/postgres']);
    assert.equal(project.baseTestClass.name, 'DatabaseTests');
    assert.deepEqual(project.baseTestClass.initializeMethods, ['ResetAsync']);
    assert.deepEqual(project.engines, ['postgres']);
    assert.equal(project.engineClasses[0].file, 'tests/Shop.Database.Tests/DatabaseTests.Engines.cs');
    assert.deepEqual(project.testMethods.map((m) => m.name), ['Schema_Applies_And_Creates_Objects']);
  });

  it('reports nothing for a repository without a DbAiTest project', () => {
    const dir = path.join(root, 'plain');
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>', 'utf8');
    assert.deepEqual(locate(dir).testProjects, []);
  });

  it('finds a project that deploys its own dacpac', () => {
    const dir = path.join(root, 'dacpac-repo');
    const project = path.join(dir, 'tests', 'Shop.Database.Tests');
    mkdirSync(project, { recursive: true });
    writeFileSync(path.join(project, 'Shop.Database.Tests.csproj'), DACPAC_CSPROJ, 'utf8');
    writeFileSync(path.join(project, 'DatabaseTests.cs'), `namespace Shop.Database.Tests;

[TestClass]
public sealed partial class DatabaseTests : DbAiTestBase
{
    protected override DbEngine CreateEngine() => new MsSqlEngine();

    protected override SchemaSource? SchemaSource =>
        new DacpacSchemaSource(Path.Join(AppContext.BaseDirectory, "Shop.Database.dacpac"));
}
`, 'utf8');
    const found = locate(dir).testProjects[0];
    assert.equal(found.schema.kind, 'dacpac');
    assert.equal(found.schema.source, 'DacpacSchemaSource');
    assert.equal(found.baseTestClass.engine, 'mssql');
    assert.deepEqual(found.engines, ['mssql']);
    assert.deepEqual(found.engineClasses, []);
  });

  it('skips build output and other projects', () => {
    const dir = repositoryWith();
    const other = path.join(dir, 'src', 'Shop.Api');
    mkdirSync(path.join(other, 'obj', 'Debug'), { recursive: true });
    writeFileSync(path.join(other, 'Shop.Api.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>', 'utf8');
    writeFileSync(path.join(other, 'obj', 'Debug', 'Shop.Api.csproj'), SCRIPTS_CSPROJ, 'utf8');
    assert.equal(locate(dir).testProjects.length, 1);
  });
});

describe('locate as a command', () => {
  it('prints the report', () => {
    const result = spawnSync(process.execPath, [script, '--root', repositoryWith()], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.testProjects[0].baseTestClass.name, 'DatabaseTests');
  });

  it('exits 2 for a root that is not a directory', () => {
    const result = spawnSync(process.execPath, [script, '--root', path.join(root, 'missing')], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^error: /);
  });
});
