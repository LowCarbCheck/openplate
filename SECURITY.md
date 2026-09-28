# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security report.** Use GitHub's private vulnerability reporting instead:

**[Report a vulnerability](https://github.com/LowCarbCheck/openplate/security/advisories/new)**

This opens a draft security advisory visible only to you and the maintainers, which keeps the issue private until a fix is ready. Use this channel for every app in this repository.

We acknowledge reports within a few days. The project does not offer a bug bounty or guaranteed turnaround times, but we will work with you on a fix and coordinated disclosure.

## Supported versions

Each app follows its own release schedule. We support only the latest release of each app, and we do not maintain LTS branches. Update to the newest image before reporting a bug.

| App | Release tags |
| --- | --- |
| [`apps/app`](apps/app) | `v*` |
| [`apps/core`](apps/core) | `core-v*` |
| [`apps/inference`](apps/inference) | `inference-v*` |

## What is in scope

Each app describes its trust model and attack surface: [the app](apps/app/SECURITY.md), [core](apps/core/SECURITY.md) and [inference](apps/inference/SECURITY.md). If you are not sure whether an issue is a vulnerability, report it privately. We can make it a public issue later.
