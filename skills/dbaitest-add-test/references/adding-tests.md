# Adding tests to a project that already has them

## What the report says

`scripts/locate-tests.mjs` prints one entry per DbAiTest test project it found:

| Field | What it means |
|---|---|
| `projectFile`, `dir` | the project file and the folder it lives in; run `dotnet test` on `dir`. |
| `name`, `rootNamespace` | the project's name and namespace; the tests live in that namespace. |
| `frameworks` | the target frameworks (`net8.0`, `net10.0`). |
| `packages` | the DbAiTest packages the project uses. |
| `schema.kind` | `scripts` (a folder of `.sql` files), `dacpac` (a database project), `source` (the test class builds a `SchemaSource` itself) or `none`. |
| `schema.roots` | where the linked script folders land (`Schema/postgres`). |
| `schema.includes` | the script patterns the project links, relative to the project folder. This is where the schema lives; `schema.roots` is where the harness finds it at run time. |
| `schema.dacpacs` | the database projects the test project references. |
| `schema.source` | the `SchemaSource` the test class builds itself, when it does (`DacpacSchemaSource`, `DirectorySchemaSource`). |
| `baseTestClass` | the class the tests belong in, with the file it is in. |
| `baseTestClass.isAbstract` | true when a class per engine inherits it; false when it is the only test class. |
| `baseTestClass.engine` | the engine, when the class creates it itself. |
| `baseTestClass.schemaSource` | the `SchemaSource` the class builds itself, when it does. |
| `baseTestClass.initializeMethods` | the `[TestInitialize]` methods already there (usually the one that cleans the database). |
| `baseTestClass.cleanupMethods` | the `[TestCleanup]` methods already there. |
| `baseTestClass.excludedDirectories` | the folders the harness skips, when the class sets them. |
| `baseTestClass.orderedDirectories` | the folders the harness applies first, in this order. |
| `engineClasses` | one class per engine: its name, its engine and its `SchemaRoot`. |
| `engineClasses[].suite` | the class it inherits the tests from. |
| `engineClasses[].excludedDirectories` | the folders the harness skips (`seed`, `maintenance`). Their objects are not in the database: no test for them. |
| `engineClasses[].excludedFileNamePatterns` | the file-name patterns the harness skips. |
| `engineClasses[].orderedDirectories` | the folders the harness applies first, in this order. |
| `testClasses` | every class that derives from `DbAiTestBase`: the suites of the project. |
| `testMethods` | the tests that exist, with the class they are in. |
| `engines` | every engine the project runs. |

The report also holds `libraryProjects` (projects that use the DbAiTest libraries but are not test
projects: ignore them) and `truncated` (true when the scan hit its limits and may have missed
something).

## Where the tests go

**A class per engine** (`baseTestClass.isAbstract` is true): the abstract class holds the tests,
each engine class inherits them and only says which engine and which schema to use.

```csharp
public abstract partial class DatabaseTests : DbAiTestBase   // the tests go here
{
    [TestMethod]
    public async Task PlaceOrder_Creates_The_Order() { … }
}

public sealed class PostgreSqlDatabaseTests : DatabaseTests    // one per engine
{
    protected override DbEngine CreateEngine() => new PostgreSqlEngine();
    protected override string? SchemaRoot => "Schema/postgres";
}
```

Add the new test to the abstract class, next to the tests that are already there. Do not add a
second `[TestInitialize]`: MSTest runs one per class, and the project already has the one that
cleans the database. Extend the existing method if a test needs reference data.

**One class that creates the engine** (`baseTestClass.isAbstract` is false): the tests go in that
class, which is already a `[TestClass]`.

Never create a second suite for the same project, and never copy the harness wiring. One
`[TestInitialize]` per class: a second one in the same class fails discovery (`UTA018`). The base
class contributes its own (`DbAiTestBase` attaches the harness) and the derived class's runs after
it, so extend the project's `ResetAsync` instead of writing a new one.

## Covering an object

**A procedure**: call it the way the application calls it (the same parameters, the same
transaction), then assert through a second channel: the rows it wrote, or the view that reads
them. A procedure that returns a value is not proved by its return value alone.

**A function**: call it in a query (`SELECT dbo.TaxFor(@amount)` on SQL Server,
`SELECT invoice_total(@id)` on PostgreSQL, `SELECT total(@id)` on MySQL) and assert the number.
Cover the empty case as well: a function that sums lines returns 0, not `NULL`.

**A view**: seed the tables it reads, then read the view. A view with a `LEFT JOIN` and a
`COALESCE` has two behaviours worth testing: the row with matching rows, and the row without.

**A table with constraints**: insert a valid row, then a row that breaks the rule, and assert that
the second one is rejected (`Assert.ThrowsAsync<DbException>`) and that nothing was written. Test
the rule, not the message: it differs per engine and per server version.

**Application code**: to test a repository or a service, construct it with
`Harness.ConnectionString` (add a project reference to the application project) and assert
through the harness, not through the code under test.

## The rules of a good test

- **One behaviour per test**, named `Object_Does_What_When`:
  `PlaceOrder_Creates_The_Order_When_The_Email_Is_New`.
- **Seed with SQL, assert through a second channel.** Seed before the assertion, so the only
  statement that may throw is the one under test.
- **The rule and its edge.** The happy path, then one rejection or boundary.
- **Independent of the other tests.** The database is cleaned before each test; a test that
  depends on the order of the others fails on its own.
- **Find rows by natural key** (`WHERE email = @email`). When the test needs the id, take it the
  way the engine gives it: `OUTPUT INSERTED.Id` on SQL Server, `RETURNING id` on PostgreSQL, and on
  MySQL read the id back (`LAST_INSERT_ID()` on the same connection, or select it by key).
- **Portable SQL.** The shared class runs on every engine the project has. Keep to what all of
  them understand: `@name` parameters, no engine-specific syntax, no `SCOPE_IDENTITY()` outside
  one connection.

## One engine only

An object that exists on one engine only (a SQL Server procedure in a project that also runs
PostgreSQL) cannot live in the shared class. Ask the user which they want:

- **keep the test, one engine**: make the engine class `partial` and put the test there.

  ```csharp
  public sealed partial class MsSqlDatabaseTests : DatabaseTests
  {
      [TestMethod]
      public async Task PlaceOrder_Creates_The_Order() { … }
  }
  ```

- **drop the object from the suite**: the test runs on every engine.

Never write engine-specific SQL in the shared class: it fails on the other engines.

## The database is shared

Every test in the class sees the same container and the same schema. `Harness.CleanAsync` (the
`[TestInitialize]` the project already has) empties every table before each test, identity
counters included. It also empties the reference data the schema seeds (lookup tables, a dacpac
post-deployment script): re-insert what the tests need in the same `[TestInitialize]`, after the
clean.

The **shape guard** snapshots every table, view and routine after the schema is applied and fails
the test that dropped, added or re-typed a column of a shared object. It detects; it does not
repair. Restore what the test changed in a `finally` block, or create its own table instead of
altering a shared one.

## Running and CI

```bash
dotnet test <project dir>
```

The first run pulls the container image and takes minutes. Run the whole project, not one test:
the new test must pass on every engine the project has.

In CI, the job needs the .NET SDK, a Docker engine and the same command. A test that only passes
on the developer's machine is a test that does not run.

## Common mistakes

| Mistake | Why it fails |
|---|---|
| Asserting only the procedure's return value | The procedure can return the right thing and write the wrong rows. |
| Seeding inside the statement under test | A failing seed makes the test pass for the wrong reason. |
| A second `[TestInitialize]` | One per class: MSTest fails discovery with `UTA018`. Extend the method that is there. |
| Editing the schema to fit the test | The test then proves the schema you just wrote, not the schema the application uses. |
| Asserting the error message | It differs per engine and per server version. |
| Depending on another test's rows | The tests run in any order; each one starts empty. |
| A new suite per engine | The same test then runs twice per engine, in a class that does not inherit the shared setup. |
