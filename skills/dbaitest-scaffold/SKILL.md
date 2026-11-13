---
name: dbaitest-scaffold
description: Adds a .NET database integration test project to the user's repository on DbAiTest (MSTest), with tests that run against a real SQL Server, PostgreSQL or MySQL in a throwaway Docker container. It first finds the database the repository already has (an SDK-style .sqlproj / .dacpac, or a folder of .sql scripts) and the engine the app uses, wires the tests to that schema, and writes tests for the procedures, functions, views and tables the user picks. Use when the user wants database integration tests, to test SQL, stored procedures, views or data-access code against a real database, or to set up DbAiTest / DbAiTest.MSTest.
license: MIT
compatibility: Needs Node.js 20+, the .NET SDK (8 or 10) and a running Docker engine.
metadata:
  dbaitest-version: "0.4.0"
  source: "@dbaitest/skills"
---

# Database integration tests with DbAiTest

Adds a test project to **the user's repository** that tests **their database** on
[DbAiTest](https://dbaitest.com/db-test/): the engine runs in a throwaway container, the schema
the repository already has is applied once, every test gets the shared database, and a shape
guard fails the test that reshapes a shared table. Two scripts do the mechanical work:
`discover.mjs` reads the repository, `scaffold.mjs` writes the project. You decide from their
output, ask only what they leave open, and write the tests.

Run every command **from the repository root**. `<skill-dir>` is only where the scripts live (the
directory of this `SKILL.md`, for example `.claude/skills/dbaitest-scaffold/` or
`.agents/skills/dbaitest-scaffold/`). Never write into the skill directory.

## 1. Preflight

| Check | Command | If it fails |
|---|---|---|
| Node 20+ | `node --version` | Install Node.js 20 or later. |
| .NET SDK 8+ | `dotnet --list-sdks` | Install the .NET 8 or 10 SDK. |
| Docker running | `docker info` | Start Docker Desktop / the Docker daemon. Tests cannot run without it. |

## 2. Discover

```bash
node <skill-dir>/scripts/discover.mjs
```

It reads the repository (it never writes or builds) and prints JSON. Read
`references/existing-schemas.md` for every field. In short:

- `engine`: the one supported engine the app uses, or `null` when there is none, several, or an
  unsupported one too; `confident` is true when a package or a database project backs it.
  `engines` lists each candidate with its `evidence`; `unsupported` lists engines DbAiTest does
  not test (SQLite, Oracle).
- `sqlprojs`: database projects, `sdkStyle` or classic, with `dacpacName` and any `builtDacpacs`.
- `scriptFolders`: folders of `.sql` files outside projects and tests, with `dialect`,
  `schemaDir` (where the schema itself is; `null` for files at the repository root) and
  `excludeFromSchemaDir` (seed, one-off or migration subfolders), plus two warnings:
  `versionedMigrations` and `possibleSeparateDatabases`.
- `testsFolder`, `solution`, `centralPackages`.

Tell the user in two or three lines what you found and the evidence for the engine.

## 3. Decide (ask only what discovery leaves open)

1. **Engine.** `engine` set → use it and say so. `null` with several candidates → ask which one;
   none at all → ask. Never default to every engine. Anything in `unsupported` → tell the user
   DbAiTest tests SQL Server, PostgreSQL and MySQL only, and stop unless they want one of those.
2. **Schema source**, first match wins:
   - an SDK-style `.sqlproj` → `--schema dacpac --sqlproj <path>` (SQL Server);
   - a classic `.sqlproj` → `--schema dacpac --dacpac <builtDacpacs[0]>` if it has been built,
     otherwise ask the user to build it in Visual Studio / MSBuild first (`references/dacpac.md`);
   - a script folder in the engine's dialect → `--schema-dir <schemaDir>` plus one
     `--exclude-dir <name>` per entry of `excludeFromSchemaDir`;
   - nothing → the starter schema (no `--schema-dir`); the user fills it in later.
   Ask instead when: there are several candidates; a folder's `schemaDir` is `null` (scripts at the
   repository root: ask which folder holds the schema); `possibleSeparateDatabases` lists folders
   (ask which database); `versionedMigrations` is true (not supported yet, see
   `references/existing-schemas.md`).
3. **Name and location.** Name: `<SolutionOrRepo>.Database.Tests`. Location: `<testsFolder>/<name>`,
   else `tests/<name>`. It must not sit under a folder that holds another `*.csproj` (that project
   would compile the tests) or inside the schema folder; pick a sibling folder if it would.

Confirm the plan in one message (engine, schema source, project location) unless `confident` is
true and nothing above was ambiguous; then go ahead.

## 4. Generate

```bash
# an SDK-style database project
node <skill-dir>/scripts/scaffold.mjs --name Shop.Database.Tests --dir tests/Shop.Database.Tests --schema dacpac --sqlproj database/Shop.Database/Shop.Database.sqlproj
# an existing folder of scripts
node <skill-dir>/scripts/scaffold.mjs --name Billing.Database.Tests --dir tests/Billing.Database.Tests --engines postgres --schema-dir db/schema
# no schema yet
node <skill-dir>/scripts/scaffold.mjs --name Inventory.Database.Tests --dir tests/Inventory.Database.Tests --engines mysql
```

`--help` lists every option. Never hand-write the files it generates: they carry the wiring
DbAiTest needs (`DoNotParallelize`, container cleanup, schema or dacpac copied next to the tests).
If it reports central package management, add the printed `<PackageVersion>` lines that
`Directory.Packages.props` does not already have. If there is a solution, add the project:
`dotnet sln <solution> add <dir>/<name>.csproj`.

What it writes:

| Schema source | Files |
|---|---|
| `--schema-dir` | `<name>.csproj` (links the folder, no copy), `AssemblyInfo.cs`, `DatabaseTests.cs` (abstract: the tests, no engine named), `DatabaseTests.Engines.cs` (one `[TestClass]` per engine) |
| `--schema dacpac` | `<name>.csproj` (database project reference + dacpac copy), `AssemblyInfo.cs`, `DatabaseTests.cs` |
| starter | `CustomerTests.cs`, `CustomerTests.Engines.cs`, `Schema/<engine>/001_tables.sql` |

## 5. Smoke test

```bash
dotnet test <dir>
```

The generated smoke test proves the schema applies. The first run pulls the image and takes
minutes. A `SchemaApplyException` names the file that failed: an existing script folder may
need more `--exclude-dir` or an order (`references/existing-schemas.md`), never an edit of the
user's schema files without asking. Other failures: `references/troubleshooting.md`.

## 6. Propose what to test

List the database's objects from the schema files (or from `Harness.ListObjectsAsync` in a
throwaway test). Propose **3 to 5** to test first, preferring, in order:

1. procedures and functions the application calls (search the app code for their names);
2. views and functions with business logic (totals, status rules, calculations);
3. tables with constraints that encode rules (`CHECK`, `UNIQUE`, foreign keys, triggers).

Give one line per object: what the test would prove. Ask the user to confirm or change the pick.
If the user already named objects, use those.

## 7. Write the tests

For each picked object, add tests to the abstract `DatabaseTests` class (dacpac: `DatabaseTests`)
following `references/writing-tests.md`:

- seed with SQL through the harness; call the object the way the app does;
- assert through a **second channel** (query the table a procedure wrote, not its return value
  alone); one behaviour per test, named `Object_Does_What_When`;
- cover the rule and its edge: the happy path plus one rejection or boundary.

Run `dotnet test <dir>` until green. Report what each test proves and anything you could not test.

## Rules

- Tests share one container per engine: never remove `[assembly: DoNotParallelize]`.
- Never point the harness at a shared, staging or production database; it only uses the
  containers it starts.
- Never change the user's schema files or database project to make a test pass; ask.
- Keep DbAiTest packages at the version this skill pins (`metadata.dbaitest-version`) unless the
  user asks to upgrade; the generated code is written and tested against it.
- CI for the new project: `references/ci.md`. Shape guard details: `references/shape-guard.md`.
  Engine dialects: `references/engines.md`.
