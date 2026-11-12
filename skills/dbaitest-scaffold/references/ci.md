# CI

GitHub-hosted `ubuntu-latest` runners have Docker, which is all the containers need.

```yaml
name: Database tests

on:
  pull_request:
  push:
    branches: [main]

jobs:
  database-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-dotnet@v6
        with:
          dotnet-version: |
            8.0.x
            10.0.x
      - name: Database tests
        run: dotnet test tests/Shop.Database.Tests --configuration Release
        env:
          # Per-test timings in dbaitest-timing.tsv next to the test binaries.
          DBAITEST_TIMING: "1"
          # Only for dacpac projects: no DacFx usage telemetry.
          DACFX_TELEMETRY_OPTOUT: "1"
```

- Windows and macOS hosted runners do not run Linux containers; keep database tests on Linux.
- The first run pulls the images (SQL Server's is the largest); budget a few minutes.
- To split engines into parallel jobs, filter by class:
  `dotnet test --filter "FullyQualifiedName~PostgreSql"`.
