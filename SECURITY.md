# Security policy

## Supported versions

Only the latest release of `@dbaitest/skills` on npm receives fixes. While the major version is 0 there are
no maintenance branches: a fix ships as the next release.

## Reporting a vulnerability

Do not open a public issue. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository
(<https://github.com/dbaitest/agent-skills/security/advisories/new>).

Include what is affected (skill or installer, and version), how to reproduce it, and what an attacker
gains. You will get an answer within seven days. Once a fix is released, the advisory is
published with credit to the reporter, unless you ask not to be named.

## Scope

The installer copies skill files into agent configuration directories, and a skill tells a coding
agent which commands to run. A report is in scope when either does something the user did not
ask for: writing outside the target directories, overwriting files it did not create, or a skill
instructing an agent to run a command that is not needed for the task it describes.

The generated test projects start throwaway database containers with default credentials; that
is by design (see DbAiTest's own security policy) and out of scope here.

The package has no runtime dependencies; the GitHub Actions it is built with are SHA-pinned and
updated by Dependabot.
