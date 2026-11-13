# Narrowing a failure down

The commands that turn "something is red" into "this line is wrong". Change one thing at a time.

## One test

```bash
node <skill-dir>/scripts/diagnose.mjs --project <dir> --filter "FullyQualifiedName~PlaceOrder_Creates_The_Order"
```

The filter takes `FullyQualifiedName~Name`, `Name~Name` or `FullyQualifiedName=Namespace.Class.Name`.
It also takes a `dotnet test` filter expression, so several tests can be selected at once.

The report of a filtered run holds only those tests: the totals are the filtered ones.

## The full output

The console summary names the failed tests but not their output. The report already carries the
message, the stack and the container log of each failed test. When you need the whole run:

```bash
dotnet test <dir> --logger "console;verbosity=detailed"
```

## The result file

`scripts/diagnose.mjs` writes the result file and the console log into a temporary folder and
prints both paths in the report. The folder is under the system temp directory, not the project:
copy what has to be shared (the result file, the log) into the repository or into a bug report
before the machine cleans the temp folder up.

The result file is the same one VSTest writes:

```bash
dotnet test <dir> --logger "trx;LogFileName=results.trx" --results-directory <dir>
```

Keep it when the failure needs to be shared: it is the evidence a maintainer can read without
running anything.

## Timings

```bash
DBAITEST_TIMING=1 dotnet test <dir>
```

Writes one row per test to `dbaitest-timing.tsv` next to the test binaries: three tab-separated
columns, `kind` (`test`), `value` (the duration in milliseconds) and `detail` (`ClassName.TestName`).
`DBAITEST_TIMING_FILE` writes it elsewhere. Only the exact value `1` switches it on, and a write
error never fails the run.

## The schema outside the test project

When the schema itself is the problem, apply it without the test project. The `dbaitest` command
is a .NET tool:

```bash
dotnet tool install --global DbAiTest.Cli      # once
dbaitest engines                               # mssql, postgres, mysql
dbaitest schema --engine postgres --schema db/schema
```

`dbaitest schema` prints the scripts it will apply, starts a container, applies the schema, lists
the objects it created and removes the container. It names the file that failed, in the engine's
dialect, with no test project in the way.

`dbaitest up --engine postgres --schema db/schema` keeps the container running and prints the
connection string, so the database can be inspected by hand. Ctrl+C stops it and removes the
container.

The CLI applies a directory of SQL files. It does not deploy a `.dacpac`.

## The containers

```bash
docker info                    # the daemon, its version, its memory
docker ps                      # the containers that are running
docker images                  # the images that are pulled
docker system df               # how much disk the images and containers use
```

The harness starts one container per engine and removes it when the run ends. The removal is the
test project's own `[AssemblyCleanup]` (`DbAiTestRun.DisposeAllAsync()`): a project without it
leaves the container behind, and so does a run that was killed. `docker rm -f <id>` clears it.

## The schema the harness applied

The engine class says what the harness does with the schema folder:

```csharp
protected override string? SchemaRoot => "Schema/postgres";

protected override SchemaLoadOptions? SchemaLoadOptions => new()
{
    ExcludedDirectories = ["seed", "maintenance"],
};
```

A folder in `ExcludedDirectories` is skipped: its objects are not in the database, so a test that
expects them fails. Files are applied in path order, so `10_x.sql` runs before `2_x.sql` unless
the files are numbered with leading zeros.

## The shape guard

The guard compares every table, view and routine with the shape the schema had when it was
applied, after every test. When it fires it names the test that changed it:

```
[ShapeGuard] MsSqlCustomerTests.Adds_A_Column left dbo.customers columns changed (id,email) -> (id,email,probe)
```

To see the guard only log instead of fail, the test class can override the property:

```csharp
protected override bool FailOnShapeLeak => false;
```

That is for finding the culprit, not for shipping: a leaking test breaks the tests after it.
