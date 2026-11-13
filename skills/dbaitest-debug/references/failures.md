# What a failure means

Find the message in the report, take the cause and the fix. Change one thing at a time.

## The test's own assertion

| Message | Cause | Fix |
|---|---|---|
| `Assertion failed. Expected values to be equal. expected: X actual: Y` | The test expected something the database did not give | Compare the two values: is the seed missing (actual is the default, e.g. `0` or `null`), or is the type wrong (`expected: 99.99` against `actual: 0` means the query returned no row, not that it returned zero)? |
| `Assertion failed. Expected exception of type X (or derived) but no exception was thrown.` | The rule the test expects did not trigger | Check that the constraint exists in the schema, that the name is written the way the schema writes it (case matters on PostgreSQL and MySQL), and that the statement really breaks it. |
| `Assertion failed. Expected exception of type X (or derived) but caught Y.` | The statement failed for another reason | Read what was caught: a syntax error is not a constraint violation. |
| `NullReferenceException` in the test | The test used something that is not there: the harness, a row, a service the test did not build | Read the stack trace in the report: it names the line. Check the seed ran before the use. |
| The command timed out (SQL Server: `Execution Timeout Expired`) | The statement waited too long; the engine's command timeout is two minutes | A lock or a wait: check for a transaction the test never commits, and for a query that waits on a lock. |

## The SQL the test ran

The engine raises its own exception: a `System.Data.Common.DbException`. Read its message and its
SQL state.

| Message | Cause | Fix |
|---|---|---|
| `relation "Customers" does not exist` (PostgreSQL) | Quoted mixed-case names | Use unquoted lower-case names, the same in the schema and in the test. |
| `Table 'shop.Customers' doesn't exist` (MySQL) | Table names are case-sensitive on Linux | Same name, same case, everywhere. |
| `Syntax error ... near "GO"` (PostgreSQL, MySQL) | SQL Server syntax in another engine | `GO` is SQL Server only; a PostgreSQL file is one command; MySQL routines use `DELIMITER`. |
| `Invalid object name 'dbo.PlaceOrder'` (SQL Server) | The procedure was not deployed, or its name is wrong | The schema must create it; the schema root the harness applies is the one the project sets. |
| `permission denied` / `access denied` | The login cannot do that | The harness uses the engine's own login; a statement that needs more rights than that is not a test. |

## The shape guard

```
[ShapeGuard] MsSqlCustomerTests.Adds_A_Column left dbo.customers columns changed (id,email) -> (id,email,probe)
```

The named test changed a shared table, a view or a routine. The guard detects; it does not repair.

| Cause | Fix |
|---|---|
| The test altered a shared table and did not put it back | Restore it in a `finally` block, or create the test's own table instead. |
| The test dropped or re-typed a column | Same: the schema must stay as the harness applied it. |
| The guard names a test that looks innocent | Each damaged object is reported once, against the first test that left it changed. An object that is put back into its baseline shape is forgotten, so a later test that breaks it again is blamed again. Fix the test it names. |

Objects a test creates itself are not watched. Only the schema as applied is.

## The schema

| Message | Cause | Fix |
|---|---|---|
| `SchemaApplyException`: "N schema script(s) failed to apply:" followed by `file: error` | The named script failed on that engine | Fix the SQL in that file, in that engine's dialect. The exception lists every file that failed. |
| `SchemaApplyException` on a file that holds data, not schema | A seed or one-off script is in the schema folder | The folder has to be left out of the schema (`ExcludedDirectories` in the test project), or the file has to move out of it. Both change the user's project: say what has to change and ask. |
| `SchemaApplyException` on a file that needs another file first | The order is wrong | `OrderedDirectories` in the engine class puts folders first, in that order. Files are otherwise applied by path, so number them with leading zeros. |
| The object does not exist, but the file that creates it applied | The file was excluded, or it created the object in another schema | Compare what the harness applied with what the test expects. |
| The `.dacpac` was not found | It was not copied next to the tests, or the name in the test class does not match | Check the `CopyDacpacs` target (or the `None` item) and the name in `DatabaseTests.cs`. |
| A dacpac deploy fails on a reference to `master` or another database | The referenced dacpacs are not next to the deployed one | Copy every `.dacpac` from the database project's output; the generated target does. |

## The container

| Message | Cause | Fix |
|---|---|---|
| Docker "not running or misconfigured", or the daemon cannot be reached | Docker is not running | Start Docker Desktop or the daemon; `docker info` must succeed. |
| The first run seems stuck for minutes | The image is being pulled | Wait; later runs reuse the image. |
| The container starts and the test then fails to connect | The engine was not ready yet | The harness waits three minutes (`DbContainerOptions.StartupTimeout`); a slower machine needs a longer timeout. |
| The SQL Server container refuses to start | SQL Server enforces a password policy and rejects a simple password at startup | Give the container a password that satisfies the policy (`DbContainerOptions.Password`). |
| "address already in use" / the port is taken | Another container holds the port | `docker ps` shows it; stop it. The harness picks a free port, so this is usually another process. |
| The image cannot be pulled | No network, or the name is wrong | `docker images`; check `DbContainerOptions.Image`. |

## The project

| Message | Cause | Fix |
|---|---|---|
| `CS0246` for `DbAiTestBase` or `TestClass` | The test folder sits under another project's folder, which compiles every `.cs` below it | Move the test project to a sibling folder, for example `tests/`. |
| `NU1008` | Central package management: a `Version` on a `PackageReference` | Remove the `Version` attributes and add the `<PackageVersion>` items to `Directory.Packages.props`. |
| `MSB4019` naming `Microsoft.Data.Tools.Schema.SqlTasks.targets` | A classic SSDT `.sqlproj` is referenced and `dotnet` cannot build it | Build it in Visual Studio or MSBuild and use the built `.dacpac`. |
| `NETSDK1045` | The SDK is older than the target framework | Install the newer SDK. |
| "No test matches the given testcase filter" | The filter names nothing | The filter takes `FullyQualifiedName~Name`; check the name in the report. |
| The suite runs zero tests | The project is not the test project, or the filter excluded everything | Run the project that references `DbAiTest.MSTest`. |

## The run, not the test

| Symptom | Cause | Fix |
|---|---|---|
| The test passes alone and fails in the suite | Rows left behind, or the tests run in parallel | Keep `[assembly: DoNotParallelize]`, and clean in `[TestInitialize]` (`Harness.CleanAsync`). |
| It fails only on one engine | SQL written for another engine | The report names the engine class. Write portable SQL, or move that test into the engine's own class. |
| It passes on your machine and fails in CI | The engine version, the SDK, or Docker differs | Compare `dotnet --list-sdks` and the image; pin both. |
| The suite is slow | Every test starts a connection; the container is shared | `DBAITEST_TIMING=1 dotnet test` writes the per-test durations. |
