---
name: dbaitest-scaffold
description: Scaffolds a new .NET database integration test project on DbAiTest (MSTest) that runs one test suite against SQL Server, PostgreSQL and/or MySQL in throwaway Docker containers, with the schema from SQL scripts or from a SQL Server .dacpac / database project (.sqlproj). Use when the user wants to start database integration tests, test SQL, stored procedures, views or data-access code against a real database, or set up DbAiTest / DbAiTest.MSTest.
license: MIT
compatibility: Needs Node.js 20+, the .NET SDK (8 or 10) and a running Docker engine.
metadata:
  dbaitest-version: "0.4.0"
  source: "@dbaitest/skills"
---

# Scaffold DbAiTest integration tests

Creates a new MSTest project on [DbAiTest](https://dbaitest.com/db-test/): each engine gets a
throwaway container, the schema is applied once, every test gets the shared database, and a
shape guard fails the test that reshapes a shared table. The generator script writes the
project; you gather the answers, run it, adapt the starter test, and get `dotnet test` green.

This skill is for **new** test projects. To change an existing DbAiTest suite, edit it directly
with `references/` as the guide.

## 1. Preflight

Run these and stop with the fix if one fails:

| Check | Command | If it fails |
|---|---|---|
| Node 20+ | `node --version` | Install Node.js 20 or later. |
| .NET SDK 8+ | `dotnet --list-sdks` | Install the .NET 8 or 10 SDK. |
| Docker running | `docker info` | Start Docker Desktop / the Docker daemon. Tests cannot run without it. |

## 2. Ask (one round, with defaults)

1. **Project name** — a C# namespace, e.g. `Shop.Database.Tests`. Default: `<RepoOrSolutionName>.Database.Tests`.
2. **Location** — default `tests/<name>` if the repository has a `tests/` folder, else `./<name>`.
   The folder must not sit under a directory that holds another `*.csproj` (an app project at the
   repository root compiles every `.cs` below it, including the tests). If it would, pick a sibling
   folder such as `tests/<name>` next to `src/`, or tell the user.
3. **Engines** — any of `mssql`, `postgres`, `mysql`. Default: the engine(s) the user's app uses; all three if unknown.
4. **Schema source**
   - `scripts` (default): `.sql` files per engine under `Schema/<engine>/`, applied in file-name order.
   - `dacpac` (SQL Server only): the user has a database project (`.sqlproj`) or a built `.dacpac`.
     Look for a `*.sqlproj` in the repository first and propose it. Only an SDK-style project
     (`<Project Sdk="Microsoft.Build.Sql">` or `MSBuild.Sdk.SqlProj`) builds with `dotnet`; for a
     classic Visual Studio SSDT project, use the `.dacpac` it builds (`--dacpac`).

Do not ask about anything the repository already answers.

## 3. Generate

Run the generator **from the repository root**. `<skill-dir>` is only where the script lives (the
directory of this `SKILL.md`, for example `.claude/skills/dbaitest-scaffold/` or
`.agents/skills/dbaitest-scaffold/`); `--dir`, `--sqlproj` and `--dacpac` are relative to the
current directory. Never generate into the skill directory.

```bash
node <skill-dir>/scripts/scaffold.mjs --name Shop.Database.Tests --dir tests/Shop.Database.Tests --engines mssql,postgres
node <skill-dir>/scripts/scaffold.mjs --name Shop.Database.Tests --dir tests/Shop.Database.Tests --schema dacpac --sqlproj src/Shop.Database/Shop.Database.sqlproj
```

Run `node <skill-dir>/scripts/scaffold.mjs --help` for every option. Never hand-write the files the
script generates: they carry the wiring DbAiTest needs (`DoNotParallelize`, container cleanup,
schema copy to output, dacpac copy). If the output says central package management is on, add
the printed `<PackageVersion>` lines to `Directory.Packages.props`.

If a solution file exists, add the project: `dotnet sln <solution> add <dir>/<name>.csproj`.

What it creates (scripts):

```
<name>.csproj                  MSTest + DbAiTest.MSTest + one DbAiTest.<Engine> package per engine
AssemblyInfo.cs                [assembly: DoNotParallelize] + AssemblyCleanup that removes the containers
CustomerTests.cs               abstract test class: the tests, written once, no engine named
CustomerTests.Engines.cs       one [TestClass] per engine: CreateEngine() and SchemaRoot
Schema/<engine>/001_tables.sql starter schema per engine
```

With `dacpac`: `<name>.csproj` (with the database project reference and the dacpac copy step),
`AssemblyInfo.cs` and `DatabaseTests.cs` (deploys the dacpac, checks that objects exist).

## 4. Make it the user's

- **Scripts:** replace the starter `customers` table with the user's real schema in every
  `Schema/<engine>/` folder — same tables, each engine's dialect (see `references/engines.md`).
  Rename `CustomerTests` to the feature under test and rewrite the starter test against real
  tables. Keep the pattern: tests in the abstract class, one small subclass per engine.
- **Dacpac:** add tests to `DatabaseTests` for the procedures, views and functions that matter.
  If the project seeds reference data in a post-deployment script, re-run it after
  `CleanAsync` (see `references/dacpac.md`).
- To test the app's own repositories, construct them with `Harness.ConnectionString`.

Harness API used in tests: `Harness.ExecuteAsync(sql, [new DbParameterValue("@p", value)], ct)`,
`Harness.QueryScalarAsync<T>(sql, ...)`, `Harness.OpenConnectionAsync(ct)`, `Harness.CleanAsync(ct)`,
`Harness.ListObjectsAsync(ct)`, `Harness.ConnectionString`. Pass `TestContext.CancellationToken`.

## 5. Run

```bash
dotnet test <dir>
```

The first run pulls the database images and takes minutes; later runs reuse them. On a failure,
read `references/troubleshooting.md` before changing anything — most failures are a stopped
Docker, a schema file in the wrong dialect, or a test that reshaped a table (shape guard).

## 6. Optional

- CI: `references/ci.md` (GitHub Actions; Docker is on `ubuntu-latest`).
- Shape guard behaviour and opting out: `references/shape-guard.md`.

## Rules

- Tests share one container per engine: never remove `[assembly: DoNotParallelize]`.
- Never point the harness at a shared, staging or production database; it only uses the
  containers it starts.
- Keep DbAiTest packages at the version this skill pins (`metadata.dbaitest-version`) unless
  the user asks to upgrade; the generated code is written and tested against it.
