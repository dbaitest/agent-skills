---
name: dbaitest-add-test
description: Adds more database integration tests to a repository that already has a DbAiTest (MSTest) test project. It finds that project, reads how it is wired (the abstract test class, the class per engine, where the schema comes from), and writes tests for the procedures, functions, views and tables the user picks, reusing the harness the project already has. Use when the user wants more database tests, wants to cover a procedure, function, view or table that has no test yet, or asks to extend an existing DbAiTest test suite.
license: MIT
compatibility: Needs Node.js 20+, the .NET SDK (8 or 10) and a running Docker engine.
metadata:
  dbaitest-version: "0.4.0"
  source: "@dbaitest/skills"
---

# More tests for a project that already has them

Adds tests to the DbAiTest test project **the user's repository already has**. The project is
found, read and extended: the new tests go into the class the project already has, so every
engine keeps running them and the harness wiring stays as it is.

This skill never creates a test project (that is `dbaitest-scaffold`'s job) and never diagnoses a
failing test. It adds tests.

Run every command **from the repository root**. `<skill-dir>` is only where the scripts live (the
directory of this `SKILL.md`, for example `.claude/skills/dbaitest-add-test/`). Never write into
the skill directory.

## 1. Preflight

| Check | Command | If it fails |
|---|---|---|
| Node 20+ | `node --version` | Install Node.js 20 or later (the locate script needs it). |
| .NET SDK 8+ | `dotnet --list-sdks` | Install the .NET 8 or 10 SDK. |
| Docker running | `docker info` | Start Docker Desktop / the Docker daemon. Tests cannot run without it. |

## 2. Locate the test project

```bash
node <skill-dir>/scripts/locate-tests.mjs
```

It reads the repository (it never writes or builds) and prints JSON. `references/adding-tests.md`
documents every field. In short:

- `testProjects`: the DbAiTest test projects it found, each with the project file, the framework,
  the DbAiTest packages, `schema` (where the schema comes from), `baseTestClass` (the class the
  tests belong in), `engineClasses` (one per engine), `testMethods` (the tests already there).
- `libraryProjects`: projects that use the DbAiTest libraries but are not test projects. Ignore
  them.
- `truncated`: true when the scan hit its limits and may have missed something. Say so.

Tell the user in two or three lines what you found: which project, which engines, which class the
tests go in.

- One project → use it.
- Several → ask which one.
- None → say that this repository has no DbAiTest test project, that `dbaitest-scaffold` creates
  one, and stop.

## 3. Read the project

Open the files the report names: the base test class, the class per engine, and the schema source.
You need four things before writing a test:

1. **Where the tests go.** The abstract class (`baseTestClass.isAbstract` is true) is shared by
   every engine: put the tests there. A project with one concrete class that creates the engine
   itself (`baseTestClass.isAbstract` is false) takes the tests in that class.
2. **Which engines run them.** `engines` lists them. A test written in the shared class runs on
   every one of them.
3. **Where the schema comes from.** `schema.kind` is `scripts` (a folder of `.sql` files), `dacpac`
   (a database project), `source` (the test class builds a `SchemaSource` itself) or `none`. A
   test that needs a table the schema does not create is a test that cannot pass: check before
   writing it. The folders the harness skips (`engineClasses[].excludedDirectories`, usually
   `seed`) are not in the database either: nothing in them can be tested.
4. **What is already tested.** `testMethods` lists the tests that exist. Do not write a second
   test for the same behaviour.

## 4. Propose what to test next

List the database's objects: from the schema scripts the project links (`schema.includes` points at
them, relative to the project folder), or from `Harness.ListObjectsAsync` in a throwaway test.
Skip the objects that already have a test.

Propose **3 to 5** objects to test next, preferring, in order:

1. procedures and functions the application calls (search the app code for their names);
2. views and functions with business logic (totals, status rules, calculations);
3. tables with constraints that encode rules (`CHECK`, `UNIQUE`, foreign keys, triggers).

Give one line per object: what the test would prove. Ask the user to confirm or change the pick.
If the user already named objects, use those.

## 5. Write the tests

Add the tests to the class from step 3, following `references/adding-tests.md` (where they go, how
to cover an object, the rules of a good test) and `references/engine-calls.md` (how to call a
procedure, a function, a view and a constraint on each engine):

- one behaviour per test, named `Object_Does_What_When`;
- seed with SQL through the harness, then assert through a **second channel** (the row a procedure
  wrote, not only what it returned);
- cover the rule and its edge: the happy path, then one rejection or boundary;
- keep the SQL portable: the shared class runs on every engine the project has. An object that
  exists on one engine only is the user's call — ask, then put that test in that engine's class
  (make the class `partial` first);
- never change the schema, the database project or the harness wiring to make a test pass.

## 6. Run

```bash
dotnet test <project dir>
```

The first run pulls the image and takes minutes. Run it until green. A failing test is fixed in
the test: seed before the assertion, assert through a second channel, keep the test independent
of the other tests. If the schema itself is wrong, say so and ask; do not edit it.

## 7. Report

Report what each new test proves, which objects are still untested, and anything you could not
test (an object that needs a second engine, a script the schema does not apply).

## Rules

- Add to the class the project already has. Never create a second suite per engine, never a
  second harness, never a copy of the `[TestInitialize]` that cleans the database.
- Never remove `[assembly: DoNotParallelize]`: the tests share one container per engine.
- Never point the harness at a shared, staging or production database; it only uses the
  containers it starts.
- Never change the user's schema files or database project to make a test pass; ask.
- Keep DbAiTest packages at the version this skill pins (`metadata.dbaitest-version`) unless the
  user asks to upgrade.
- The shape guard fails a test that changes a shared table: restore what you changed, or create
  your own table. `references/adding-tests.md` has the details.
