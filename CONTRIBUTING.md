# Contributing

Thanks for helping. This repository holds Agent Skills for dbaitest projects and the
`@dbaitest/skills` npm installer.

## Layout

```
skills/<name>/          one directory per skill, in the Agent Skills format (SKILL.md at the root)
bin/, src/              the installer (plain ESM JavaScript, no runtime dependencies)
compat.json             the dbaitest package versions the skills are written and tested against
test/                   node --test suites
```

## Workflow

- Branch from `main`, open a pull request, fill in the template. `main` is protected: a merge
  needs green CI and an approving review from a code owner other than the author.
- Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat(skill): ...`, `fix(installer): ...`); the squash merge uses the title as the commit.
- History is linear: squash merges only.

## Running the checks

```bash
npm test
```

Requires Node 20 or later. Scaffolding and running a generated project also needs the .NET SDK
(8 and 10) and a running Docker.
