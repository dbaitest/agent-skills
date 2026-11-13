# Changelog

All notable changes to `@dbaitest/skills` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/) — while the major version is 0, a minor release may
change the installer's behaviour or a skill's generated output, and such changes are listed first.

## [Unreleased]

### Added

- **`dbaitest-add-test`**: adds more tests to a repository that already has a DbAiTest test
  project. `scripts/locate-tests.mjs` finds that project and reports how it is wired (the
  abstract test class, the class per engine, where the schema comes from, the tests that are
  already there); the agent proposes the objects that are not covered yet, writes those tests
  into the class the project already has, and runs `dotnet test`.
  `references/adding-tests.md` covers where the tests go and how to cover an object;
  `references/engine-calls.md` covers the calls per engine, with examples the CI compiles and
  runs against real containers. The scaffolder is unchanged.

## [0.2.0] - 2026-11-13

### Breaking

- `scaffold.mjs` requires `--engines` for scripts mode. It no longer generates all three engines
  when none is given; the skill names the engine the repository uses (discovered) or asks.
  Upgrade an installed copy with `npx @dbaitest/skills@latest add --force`.

### Added

- **The skill starts from the user's repository.** `scripts/discover.mjs` reads it (never writes
  or builds) and reports, with evidence, the engine the app uses (packages, connection strings,
  compose images, SQL dialect) and the database it already has: SDK-style or classic `.sqlproj`
  files (with built dacpacs) and folders of `.sql` scripts (with the schema subfolder and the
  seed or one-off folders to leave out).
- `scaffold.mjs --schema-dir <path>` links an existing script folder into the test project (one
  source of truth) instead of writing a starter schema, with a `DatabaseTests` smoke suite;
  `--exclude-dir <name>` writes `SchemaLoadOptions.ExcludedDirectories`.
- After the smoke test, the agent proposes 3-5 procedures, functions, views or tables to test,
  the user confirms, and the agent writes the tests. `references/writing-tests.md` holds tested
  patterns per engine (procedures with output parameters, functions, views, `CALL`, constraint
  violations); `references/existing-schemas.md` documents discovery and script folders.

## [0.1.1] - 2026-11-13

### Changed

- Releases are published from GitHub Actions through npm trusted publishing, with a provenance
  statement, and only after a maintainer approves the staged version with 2FA.
- `package.json` no longer asks npm for provenance itself (`publishConfig.provenance`), which made
  any publish outside CI fail. The installer and the skill are unchanged.

## [0.1.0] - 2026-11-13

First release.

### Added

- **`dbaitest-scaffold`**: scaffolds a new DbAiTest MSTest project (DbAiTest 0.4.0, net8.0 or
  net10.0) for SQL Server, PostgreSQL and/or MySQL from schema scripts, or for SQL Server from an
  SDK-style database project (`--sqlproj`) or a prebuilt `.dacpac`. The agent runs the skill's
  generator (`scripts/scaffold.mjs`), which honours `global.json` and central package management,
  and refuses classic SSDT projects with a pointer to `--dacpac`. References cover the engines,
  dacpac deployment, the shape guard, CI and troubleshooting.
- **`npx @dbaitest/skills add | remove | list`**: installs the skills into `.claude/skills`
  (Claude Code) and `.agents/skills` (Codex, Cursor, GitHub Copilot), in the project or with
  `--global` in the home directory. It refuses folders it did not create, never leaves a partial
  copy, treats a CRLF checkout as up to date, and needs `--force` to replace or remove an edited
  copy.

[Unreleased]: https://github.com/dbaitest/agent-skills/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/dbaitest/agent-skills/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/dbaitest/agent-skills/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/dbaitest/agent-skills/releases/tag/v0.1.0
