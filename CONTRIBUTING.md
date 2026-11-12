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

## Upgrading DbAiTest

`compat.json` names the DbAiTest release the skills are written against. A weekly workflow opens
an issue when nuget.org has a newer one. To move:

1. Set `dbaitest` (and, if needed, `targetFrameworks` or the test packages) in `compat.json`.
2. Run `node scripts/sync-compat.mjs`; it updates each skill's `versions.json` and metadata, and
   names any prose that must change by hand.
3. Read the DbAiTest changelog and update the skills for renamed or removed APIs.
4. Open a pull request. CI checks every DbAiTest identifier against the new tag and runs the
   generated projects against real containers.

## Releasing

A release is a tag plus a GitHub release. The `Publish` workflow runs on the published release,
sets the package version from the tag (`package.json` keeps `0.0.0` on `main`), runs the tests and
package checks, and publishes to npm with provenance.

```bash
# Move the Unreleased section of CHANGELOG.md under the new version first.
gh release create v0.1.0 --notes-file <(awk '/^## \[0.1.0\]/{f=1; next} /^## \[|^\[/{f=0} f' CHANGELOG.md)
```

The workflow publishes through **trusted publishing**: GitHub mints an OIDC token and npm checks
it against the trusted publisher registered on the package (npmjs.com → `@dbaitest/skills` →
Settings → Trusted publishing):

| Field | Value |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `dbaitest` |
| Repository | `agent-skills` |
| Workflow filename | `publish.yml` |
| Environment | `npm` |

The `npm` environment allows deployments from `v*` tags and `main` only. A trusted publisher can
only be added to a package that exists, so the very first version (0.1.0) is published by a
maintainer, from a clean, up-to-date `main`, before its release is created:

```bash
git switch main && git pull
npm version 0.1.0 --no-git-tag-version
npm publish --access public      # asks for the npm 2FA code
git checkout -- package.json
gh release create v0.1.0 --target "$(git rev-parse HEAD)" --notes-file <(awk '/^## \[0.1.0\]/{f=1; next} /^## \[|^\[/{f=0} f' CHANGELOG.md)
```

The release tags the same commit; its workflow run finds 0.1.0 on npm and only runs the checks.

If a publish fails half way, run the `Publish` workflow by hand with the release tag.
