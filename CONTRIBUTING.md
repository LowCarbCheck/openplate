# Contributing

Thanks for looking at openplate. This is a small, opinionated project. Issues and pull requests are welcome. Open an issue to discuss anything non-trivial before you send a pull request.

## Setup

Run this once after cloning:

```bash
git config core.hooksPath .githooks
```

`core.hooksPath` lives in `.git/config`, which a clone does not copy. Without it, the pre-push gate never runs. This repository has no cloud CI. Nothing else catches a failure, so a broken push simply lands.

The gate finds which apps a push changes and runs the checks for each one. A change outside `apps/` runs all of them.

## Working on one app

Every app in `apps/` is its own project, with its own lockfile and scripts. Change into its folder and follow its README:

```bash
cd apps/app
pnpm install
pnpm dev
```

The app's [CONTRIBUTING.md](apps/app/CONTRIBUTING.md) lists the checks a pull request must pass. Where an app has an `AGENTS.md`, that file contains its coding guidelines.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`.

## Licensing

openplate is open source under the [MIT License](LICENSE). By opening a pull request, you agree that your contribution is licensed to the project under those same terms. There is no CLA to sign and no copyright assignment.
