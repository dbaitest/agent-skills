---
name: dbaitest-debug
description: Diagnoses a failing DbAiTest (MSTest) test in a repository that already has a DbAiTest test project. It runs the suite, reads the result file, names the test and the engine class that failed, and works out the cause — the test's own assertion, the SQL it ran, the shape guard, a schema that does not apply, Docker, or the project wiring — then fixes the test. Use when a database test fails, when the user asks why a test is red, when a test fails on one engine only, or when the suite fails with a shape guard or a schema apply error.
license: MIT
compatibility: Needs Node.js 20+, the .NET SDK (8 or 10) and a running Docker engine.
metadata:
  dbaitest-version: "0.4.0"
  source: "@dbaitest/skills"
---

# Why a test is red

Finds out why a DbAiTest test fails, and fixes it. The project's tests are already there; this
skill reads the failure, names the cause, and changes the test that is wrong.

It never creates a test project (that is `dbaitest-scaffold`'s job), never writes new tests for
uncovered objects (that is `dbaitest-add-test`'s job), and never edits the user's schema to make a
failure go away.

Run every command **from the repository root**. `<skill-dir>` is only where the scripts live (the
directory of this `SKILL.md`, for example `.claude/skills/dbaitest-debug/`).

## 1. Preflight

| Check | Command | If it fails |
|---|---|---|
| .NET SDK 8+ | `dotnet --list-sdks` | Install the .NET 8 or 10 SDK. |
| Docker running | `docker info` | Start Docker Desktop / the Docker daemon. Tests cannot run without it. |

Node 20+ is needed for the report script.

## 2. Find the test project

The test project is the one whose `.csproj` references `DbAiTest.MSTest`. Search the repository for
it (there is usually one).

Then read two things of that project, because the report of the next step is easier to read with
them in hand:

- **the abstract test class** — the class that derives from `DbAiTestBase`. The tests live there,
  one copy per engine.
- **the class per engine** — `PostgreSqlDatabaseTests`, `MsSqlDatabaseTests`, `MySqlDatabaseTests`
  and the like. Each says which engine it runs on and where that engine's schema comes from
  (`SchemaRoot`, `SchemaSource`).

If the repository has no such project, it has no DbAiTest tests to debug: say so and stop.

## 3. Reproduce and report

```bash
node <skill-dir>/scripts/diagnose.mjs --project <test project dir>
```

It runs the suite with the result logger and prints a JSON report: the totals, and for every
failure the test, **the engine class it failed in**, the message, the stack trace and what the
container logged while it ran. It exits 0 whenever it produced a report, even when the tests
failed: a red suite is an answer, not a script error.

Read `firstFailure` first. The failures that follow usually share its cause.

**When `resultFile` is null**, the suite never ran: the project did not build, or the filter
matched no test. The reason is in `error` (the last lines of the console output) and in `log`.
Those failures — a compile error, a package problem, a filter that matches nothing — are in
`references/failures.md` under "The project", and they never appear in `failures`.

Tell the user what failed and where, in two or three lines, before you change anything.

## 4. Classify the failure

`references/failures.md` maps the message to the cause and the fix, per class of failure:

- **the test's own assertion** (`Assertion failed. Expected values to be equal.`);
- **the SQL the test ran** (a `DbException` from the engine);
- **the shape guard** (`[ShapeGuard] … left … changed`);
- **the schema** (`SchemaApplyException`, or an object that does not exist);
- **the container** (Docker, the image, the connection);
- **the project** (compile errors, central package management, a filter that matches nothing).

Name the class of failure before you change anything, and say which line of the reference you are
following.

## 5. Narrow it down

`references/narrowing.md` has the commands. The ones that matter most:

```bash
# one test only
node <skill-dir>/scripts/diagnose.mjs --project <dir> --filter "FullyQualifiedName~The_Test"
# the full console output, not the summary
dotnet test <dir> --logger "console;verbosity=detailed"
# per-test timings, when the suite is slow
DBAITEST_TIMING=1 dotnet test <dir>
```

Change one thing at a time and re-run. A suite that fails only in full, but passes test by test,
is a different failure from one that fails on its own.

## 6. Fix it

Fix the test. The usual causes are in the test, not in the database:

- the seed did not insert what the test assumed (the row is missing, the id is wrong);
- the expectation compares the wrong value (a `decimal` against an `int`, a count against a sum);
- the test depends on another test's rows, or on the order the tests run in;
- the SQL is written for another engine, or uses the wrong case for an object name.

Never:

- weaken the assertion until it is green (delete it, assert something trivially true, or catch the
  exception). The test has to keep meaning what it meant;
- change the schema, the database project or the harness wiring to make a test pass. If the schema
  really is wrong, say so, name the file and the line, and ask;
- remove `[assembly: DoNotParallelize]`, or point the harness at a shared database.

## 7. Prove it

Re-run the **whole** suite, not only the test you fixed: the fix may have changed what another test
sees.

```bash
node <skill-dir>/scripts/diagnose.mjs --project <dir>
```

A green run is the evidence. Report the report.

## 8. Report

- The cause, in one line: what failed and why.
- The change you made to the test.
- The evidence: the report before and after.
- What you could not determine, and what the user has to decide.

## Rules

- Read the **first** error, not the last. Later failures usually share its cause.
- One change at a time, and re-run after each.
- A test that fails on one engine only is usually SQL written for another engine. The engine class
  in the report says which.
- The shape guard names the test that reshaped a shared object. Fix that test, not the guard.
- Keep DbAiTest packages at the version this skill pins (`metadata.dbaitest-version`) unless the
  user asks to upgrade.
