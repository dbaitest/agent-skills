# Troubleshooting

Find the symptom, apply the fix, run `dotnet test` again. Change one thing at a time.

| Symptom | Cause | Fix |
|---|---|---|
| Docker "not running or misconfigured", or cannot connect to the Docker daemon | Docker is not running | Start Docker Desktop or the daemon; `docker info` must succeed. |
| The first run seems stuck for minutes | Images are being pulled | Wait; later runs reuse the images. |
| `SchemaApplyException` naming a file | That file failed on that engine | Fix the SQL in the file it names, in that engine's dialect (`engines.md`). |
| Syntax error near `GO` on PostgreSQL or MySQL | SQL Server syntax copied to another engine | `GO` is SQL Server only; a PostgreSQL file is one command, MySQL routines use `DELIMITER`. |
| Tests pass alone, fail together | Rows left behind, or tests run in parallel | Keep `[assembly: DoNotParallelize]`; call `Harness.CleanAsync()` in `[TestInitialize]`. |
| `[ShapeGuard] ... left ... changed` | The named test altered a shared table | Restore the change in that test, or give it its own table (`shape-guard.md`). |
| `relation "Customers" does not exist` (PostgreSQL) | Quoted mixed-case names | Use unquoted lower-case `snake_case` names on every engine. |
| `Table '...Customers' doesn't exist` (MySQL) | Table names are case-sensitive on Linux | Same names, same case, in the schema and the test SQL. |
| The `.dacpac` was not found | Not copied to the output, or a different file name | Check the `CopyDacpacs` target or `None` item; match the name in `DatabaseTests.cs` to the project's output. |
| Dacpac deploy fails on a reference to `master` or another database | Referenced dacpacs are not next to the deployed one | Copy every `.dacpac` from the database project's output (the generated target does). |
| `SchemaSource cannot be combined with SchemaRoot` | Both are overridden | Override only `SchemaSource` for a dacpac. |
| `NU1008` (central package management) | `Version` on a `PackageReference` with CPM on | Remove the `Version` attributes; add `<PackageVersion>` items to `Directory.Packages.props`. |
| Warnings as errors on the generated files (for example `CS1591`) | The repository's `Directory.Build.props` is strict | Add `<NoWarn>$(NoWarn);CS1591</NoWarn>` to the test project, as test projects usually do. |
| `NETSDK1045`: the target framework is not supported | The SDK is older than the target framework | Install the newer SDK, or regenerate with `--framework net8.0`. |

Still failing: read the first error in the output, not the last; later failures usually share
its cause. `DBAITEST_TIMING=1 dotnet test` writes per-test timings when the suite is slow.
