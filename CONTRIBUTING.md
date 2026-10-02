# Contributing

Thanks for looking at openplate. This is a small, opinionated project. Issues and pull requests are welcome. Open an issue to discuss anything non-trivial before you send a pull request.

## Setup

You need Node 24 or newer, pnpm 11, git, and make. Nix and the toolbox are optional. The root [README](README.md#first-ten-minutes) explains both. Run this once after cloning:

```bash
make install
```

`make install` activates the pre-push hooks and installs every app. `make hooks` activates only the hooks. Both set `core.hooksPath` in `.git/config`. Git clones do not copy this setting. Without it, the pre-push gate never runs. This repository has no cloud CI. Nothing else catches failures, so broken pushes land.

The gate checks which apps change in a push and tests each one. Any change outside `apps/` tests all of them. To run every gate check without pushing:

```bash
make check
```

## Working on one app

Every app in `apps/` is an independent project with its own lockfile and scripts. The repository holds three independent apps and no root pnpm workspace. The root README explains [why](README.md#four-independent-apps). Start an app from the root:

```bash
make dev APP=app
```

Or switch to its directory and run its scripts:

```bash
cd apps/app
pnpm install
pnpm dev
```

The app's [CONTRIBUTING.md](apps/app/CONTRIBUTING.md) lists the pull request checks. If an app has an `AGENTS.md`, that file contains its coding guidelines.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`.

## Licensing

openplate is open source under the [MIT License](LICENSE). By opening a pull request, you agree that your contribution is licensed to the project under those same terms. There is no CLA to sign and no copyright assignment.
