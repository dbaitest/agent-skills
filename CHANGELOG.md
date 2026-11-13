# Changelog

All notable changes to `@dbaitest/skills` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/) — while the major version is 0, a minor release may
change the installer's behaviour or a skill's generated output, and such changes are listed first.

## [Unreleased]

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

[Unreleased]: https://github.com/dbaitest/agent-skills/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/dbaitest/agent-skills/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/dbaitest/agent-skills/releases/tag/v0.1.0
