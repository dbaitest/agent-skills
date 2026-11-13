# agent-skills

[![CI](https://github.com/dbaitest/agent-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/dbaitest/agent-skills/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@dbaitest/skills.svg)](https://www.npmjs.com/package/@dbaitest/skills)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-dbaitest.com-0b7285.svg)](https://dbaitest.com/)

[Agent Skills](https://agentskills.io/) for dbaitest projects, installable into **Claude Code,
Codex, Cursor and GitHub Copilot** with one command.

| Skill | What it does |
|---|---|
| `dbaitest-scaffold` | Adds a .NET database integration test project on [DbAiTest](https://dbaitest.com/db-test/) to your repository. It finds the database the repository already has (an SDK-style `.sqlproj` / `.dacpac`, or a folder of `.sql` scripts) and the engine the app uses (SQL Server, PostgreSQL or MySQL), wires the tests to that schema in a throwaway Docker container, and writes tests for the procedures, functions, views and tables you pick. |

## Install

```bash
npx @dbaitest/skills add             # into this project, for every supported agent
npx @dbaitest/skills add --global    # into your home directory instead
```

Then, in your repository, ask your agent, for example: *"add database integration tests; test the
order procedure first"*. It checks for Node, the .NET SDK and Docker, reads the repository to find
the engine and your existing database project or schema scripts, generates the test project
wired to them, proposes the objects to test first, writes those tests, and runs `dotnet test`. It
asks only what it cannot tell from the repository.

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
| 0.2.x | 0.4.0 | net8.0, net10.0 |
| 0.1.x | 0.4.0 | net8.0, net10.0 |

## License

[MIT](LICENSE)
