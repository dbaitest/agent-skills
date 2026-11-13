# Finding and using the repository's schema

## What `discover.mjs` reports

```json
{
  "engine": "postgres",
  "confident": true,
  "engines": [{ "engine": "postgres", "evidence": [{ "signal": "package Npgsql", "strength": "strong", "file": "src/Billing/Billing.csproj" }] }],
  "unsupported": [],
  "sqlprojs": [{ "path": "database/Shop.Database/Shop.Database.sqlproj", "sdkStyle": true, "dacpacName": "Shop.Database.dacpac", "builtDacpacs": [] }],
  "scriptFolders": [{
    "path": "db", "files": 3, "dialect": "postgres",
    "subfolders": ["schema", "seed"], "suggestedExclusions": ["seed"],
    "schemaDir": "db/schema", "excludeFromSchemaDir": [],
    "versionedMigrations": false, "possibleSeparateDatabases": []
  }],
  "solution": "Billing.sln", "testsFolder": "tests", "centralPackages": false, "sdkVersion": "10.0.100", "truncated": false
}
```

| Field | Meaning |
|---|---|
| `engine` | The one supported engine every signal agrees on; `null` when none, several, or an unsupported engine also appears. |
| `confident` | `engine` is backed by a `strong` signal (a package or a `.sqlproj`), not only by configuration or SQL dialect. Confirm with the user when false. |
| `engines[].evidence` | Why, as the name of the rule that matched (never the matched text, so no password is repeated): a package (ADO.NET drivers, EF Core providers, Aspire, Testcontainers, DbUp, FluentMigrator), a connection-string key or container image in `appsettings*.json`, `local.settings.json`, `*.config`, `.env*`, `docker-compose*.yml`, a `.sqlproj`, or a script folder's dialect. Keys several drivers share (`Data Source`, `Server`, `TrustServerCertificate`) are not evidence. |
| `unsupported` | Engines DbAiTest does not test (SQLite, Oracle), with their evidence. |
| `sqlprojs[]` | SQL Server database projects. `sdkStyle: true` builds with `dotnet` (`--sqlproj`); classic ones need Visual Studio / MSBuild, then `--dacpac` with a `builtDacpacs` entry. |
| `scriptFolders[]` | `.sql`/`.psql` files outside database projects, test projects and build output, grouped under their schema folder (`db/`, `database/`, `sql/`, `schema/`, `*.Database/`, or their own folder). |
| `scriptFolders[].dialect` | `mssql` (`GO`, `IDENTITY(1,1)`, `NVARCHAR`), `postgres` (`$$`, `SERIAL`, `plpgsql`, `GENERATED … AS IDENTITY`), `mysql` (`DELIMITER`, `AUTO_INCREMENT`, `ENGINE=`), or `null` for plain SQL with no telling marker — ask. |
| `schemaDir`, `excludeFromSchemaDir` | What to pass as `--schema-dir` and `--exclude-dir`: the one subfolder holding the schema when the others are seed, one-off or migration scripts, else the folder itself with those subfolders excluded. `null` for scripts at the repository root: ask where the schema is (the test project cannot sit inside its schema folder). Subfolders named after engines (`postgres/`, `mssql/`) or in different dialects are reported as separate folders. |
| `versionedMigrations` | File names carry a migration version (`V1__…`, `20240101_…`). Not supported yet (see below). |
| `possibleSeparateDatabases` | Sibling subfolders that each create tables and are not object-type folders (`tables/`, `views/` …), such as `database/Billing` and `database/Shop`: ask which database the tests are for, then pass that subfolder. |
| `truncated` | The scan stopped at its depth or file limit; ask the user where the schema is if nothing was found. |

Skipped: every dot-folder (`.git/`, `.vs/`, `.idea/`, `.venv/`, `.next/`, `.claude/`, `.agents/` …), `bin/ obj/ node_modules/ packages/ artifacts/ dist/ build/ out/ coverage/ vendor/ target/ TestResults/`, and every test project's folder (MSTest, xUnit, NUnit, TUnit, `MSTest.Sdk`). Only project, configuration and `.sql` files count toward the file limit. Symbolic links are not followed.

## Script folders

The test project links the folder (`--schema-dir`), so the schema has one source of truth:

```xml
<None Include="..\..\db\schema\**\*.sql;..\..\db\schema\**\*.psql"
      Exclude="..\..\db\schema\**\bin\**;..\..\db\schema\**\obj\**"
      LinkBase="Schema\postgres" CopyToOutputDirectory="PreserveNewest" />
```

DbAiTest applies the files in order of their path relative to the folder: `001_tables.sql` before
`002_functions.sql`, `tables/` before `views/`. When the repository's order is not alphabetical,
set `OrderedDirectories` in the engine class; when some subfolders are not schema, exclude them:

```csharp
protected override SchemaLoadOptions? SchemaLoadOptions => new()
{
    ExcludedDirectories = ["seed", "maintenance"],
    ExcludedFileNamePatterns = ["^drop_", "^fix_"],
    OrderedDirectories = ["tables", "functions", "views"],
};
```

`--exclude-dir` writes the `ExcludedDirectories` part (a folder name, matched at any depth under
the schema folder; the generator refuses a name no folder has); add the rest by hand when the smoke test
names a file that failed because of order or because it is not schema. Excluded files are
reported, never silently dropped.

Per engine:
- **SQL Server:** batches separated by `GO` (`GO 5` repeats). A script that relies on SQLCMD
  (`:r`, `:setvar`) cannot be applied as is.
- **PostgreSQL:** each file is one command; function bodies use `$$ … $$`. `.psql` files are read too.
- **MySQL:** routines need `DELIMITER //` … `DELIMITER ;` around them.

Migration folders whose order is a version number (`V1__init.sql`, `V10__…`, Flyway/DbUp) are not
supported yet: `V10` sorts before `V2`. Tell the user and use the starter schema, or a folder of
their current schema if they have one.

## Database projects

See `dacpac.md`. An SDK-style project is referenced, so `dotnet test` builds and deploys the
dacpac on every run; a classic project is deployed from its built `.dacpac`, so rebuild it in
Visual Studio after a schema change.

## When discovery is not enough

Ask the user, with what you found, when: the engine is `null`; there are several database projects
or script folders; a folder's `dialect` is `null` or differs from the engine; or nothing was found
but the user says the schema exists (it may be under a skipped folder, or generated by an ORM such
as EF Core migrations, which this skill does not apply — use the starter schema and say so).
