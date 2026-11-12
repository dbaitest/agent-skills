# agent-skills

[![CI](https://github.com/dbaitest/agent-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/dbaitest/agent-skills/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@dbaitest/skills.svg)](https://www.npmjs.com/package/@dbaitest/skills)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-dbaitest.com-0b7285.svg)](https://dbaitest.com/)

[Agent Skills](https://agentskills.io/) for dbaitest projects, installable into **Claude Code,
Codex, Cursor and GitHub Copilot** with one command.

| Skill | What it does |
|---|---|
| `dbaitest-scaffold` | Scaffolds a new .NET database integration test project on [DbAiTest](https://dbaitest.com/db-test/): one MSTest suite that runs against SQL Server, PostgreSQL and/or MySQL in throwaway Docker containers, with the schema from SQL scripts or from a SQL Server database project (`.sqlproj` / `.dacpac`). |

## Install

```bash
npx @dbaitest/skills add             # into this project, for every supported agent
npx @dbaitest/skills add --global    # into your home directory instead
```

Then ask your agent, for example: *"add database integration tests for SQL Server and
PostgreSQL"*. It checks for Node, the .NET SDK and Docker, asks which engines and which schema
source, generates the project with the skill's script, and runs `dotnet test`.

A project install is meant to be committed, so everyone on the project gets the skill. The
installer prints the folders to commit, and warns when `.gitignore` hides them.

### Where the skills go

| Agent | Project | `--global` |
|---|---|---|
| Claude Code | `.claude/skills/<skill>` | `~/.claude/skills/<skill>` |
| Codex, Cursor, GitHub Copilot | `.agents/skills/<skill>` | `~/.agents/skills/<skill>` |

Cursor and Copilot also read `.claude/skills`, and Copilot reads `.github/skills`; `.agents/skills`
is the folder all three non-Claude agents share. Narrow the targets with `--agent`:

```bash
npx @dbaitest/skills add --agent claude --agent cursor
```

### Commands

```text
npx @dbaitest/skills add [skill...]      install (default command; default: every skill)
npx @dbaitest/skills remove [skill...]   remove skills this installer put there
npx @dbaitest/skills list                show the dbaitest skills installed here and globally

  --global      use the home directory instead of the project
  --agent       claude | codex | cursor | copilot | all (repeatable; default: all)
  --dir         the project directory (default: the current directory)
  --force       replace (or remove) a copy that differs from this version; local edits are lost
  --dry-run     print what would change
```

The installer never touches a folder it did not create, and never leaves a half-copied skill: a
new copy is written beside the skills folder and swapped in. An identical copy is left alone, so
`add` is safe to run again; to upgrade, run `npx @dbaitest/skills@latest add --force`.

### With the `skills` CLI

The repository follows the standard `skills/<name>/SKILL.md` layout, so the
[`skills`](https://github.com/vercel-labs/skills) CLI installs it too:

```bash
npx skills add dbaitest/agent-skills
```

## Requirements

- **Node.js 20+** to install and to run the skill's generator.
- For the generated projects: the **.NET SDK** (8 or 10) and a running **Docker** engine.

## Compatibility

Each release pins the DbAiTest version its skills are written and tested against; CI generates
the projects with the skill's own script and runs them against real containers on that version.

| `@dbaitest/skills` | DbAiTest | Target frameworks |
|---|---|---|
| 0.1.x | 0.4.0 | net8.0, net10.0 |

## License

[MIT](LICENSE)
