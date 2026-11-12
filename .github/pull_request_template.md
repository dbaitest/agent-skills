## What changed

<!-- One or two sentences. What does this PR do, and why? -->

## Why

<!-- The problem this solves. Link the issue if there is one: "Fixes #123" -->

## How it was verified

<!--
What did you run, and what did you see? Be specific: a command, a generated project, a
before/after. "Tests pass" is not evidence on its own; say what proves the change does
what it claims.

    npm test                                        # installer and skill checks
    node skills/dbaitest-scaffold/scripts/scaffold.mjs ... && dotnet test
-->

## Checklist

- [ ] `npm test` passes
- [ ] A change to a skill's templates was scaffolded and `dotnet test` passed on every affected engine
- [ ] Every DbAiTest API name in changed skill files exists at the version in `compat.json`
- [ ] `SKILL.md` still follows the Agent Skills spec (name, description, allowed keys)
- [ ] User-facing changes are reflected in the README and CHANGELOG
