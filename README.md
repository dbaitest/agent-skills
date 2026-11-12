# agent-skills

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-dbaitest.com-0b7285.svg)](https://dbaitest.com/)

[Agent Skills](https://agentskills.io/) for dbaitest projects, installable into **Claude Code,
Codex, Cursor and GitHub Copilot** with one command.

| Skill | What it does |
|---|---|
| `dbaitest-scaffold` | Scaffolds a new .NET database integration test project on [DbAiTest](https://dbaitest.com/db-test/): one MSTest suite that runs against SQL Server, PostgreSQL and MySQL in throwaway containers. |

> Work in progress: the skill and the `@dbaitest/skills` installer are not released yet.

## Install

```bash
npx @dbaitest/skills add             # into this project, for every supported agent
npx @dbaitest/skills add --global    # into your home directory instead
```

Or with the [`skills`](https://github.com/vercel-labs/skills) CLI:

```bash
npx skills add dbaitest/agent-skills
```

## License

[MIT](LICENSE)
