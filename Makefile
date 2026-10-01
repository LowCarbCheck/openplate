# The front door of the openplate monorepo (M269 spec 08).
#
# There is no workspace at this root: no package.json, no pnpm-workspace.yaml,
# no shared lockfile. Each app under apps/ installs, tests and releases on its
# own. Every target here loops over the four apps and runs that app's own
# commands, so this file holds no third copy of a gate.
#
# Every per-app command is written out by make itself (static pattern rules,
# one target per app), so `make -n <target>` prints a literal apps/<name> line
# for each app. The spec's checks read that dry-run text.
#
#   make install          turn the hooks on, then pnpm install in every app
#   make test             every app's unit tier
#   make dev APP=<app>    one app's dev server
#   make check            every app's full pre-push gate, through its own hook
#   make hooks            point core.hooksPath at .githooks (needs no node)
#   make drift            the node and pnpm drift check, scripts/check-env-drift.sh

APPS := app core inference website
NODE_MAJOR := 24

# The unit tier per app. Inference's `test` is bare vitest, which WATCHES and
# never returns, so it gets `--run`. The others name their unit script.
unit_test_app := test:unit
unit_test_core := test:unit
unit_test_inference := test --run
unit_test_website := test:unit

# `make check HOOK_STDIN=<file>` feeds that file to every hook instead of the
# synthetic push line. The control `make check HOOK_STDIN=/dev/null` must FAIL
# with "ran no gate stage": a hook given no ref line runs nothing and exits 0.
HOOK_STDIN ?=
ZERO_SHA := 0000000000000000000000000000000000000000

.DEFAULT_GOAL := help

# ── early stops, before any app work ────────────────────────────────────────
# These run at parse time, so `make -n` shows them too. hooks, drift and help
# need neither node nor pnpm.
app_goals := $(filter install test dev check install-% test-% check-%,$(MAKECMDGOALS))

ifneq ($(filter dev,$(MAKECMDGOALS)),)
  ifeq ($(strip $(APP)),)
    $(error APP is required, use make dev APP=<app>)
  endif
  ifeq ($(filter $(APP),$(APPS)),)
    $(error unknown app $(APP), use one of: $(APPS))
  endif
endif

ifneq ($(app_goals),)
  ifeq ($(shell command -v node 2>/dev/null),)
    $(error node is required, install Node $(NODE_MAJOR) or newer)
  endif
  ifeq ($(shell command -v pnpm 2>/dev/null),)
    $(error pnpm is required, install pnpm)
  endif
  node_major := $(shell node -p 'process.versions.node.split(".")[0]' 2>/dev/null)
  ifneq ($(node_major),)
    ifeq ($(shell [ "$(node_major)" -ge $(NODE_MAJOR) ] 2>/dev/null && echo ok),)
      $(error Node $(node_major) is too old, install Node $(NODE_MAJOR) or newer)
    endif
  endif
  # A clone carries the hook files but not core.hooksPath, which lives in
  # .git/config. Until it is set, a git push runs no gate at all.
  ifeq ($(shell git config core.hooksPath 2>/dev/null),)
    $(warning core.hooksPath is not set, so a git push runs no gate. Run make hooks, make install sets it too)
  endif
endif

.PHONY: help hooks install test dev check drift
.PHONY: $(APPS:%=install-%) $(APPS:%=test-%) $(APPS:%=check-%)

help:
	@echo "make install          turn the pre-push hooks on, then pnpm install in every app"
	@echo "make test             run every app's unit tests"
	@echo "make dev APP=<app>    start one app's dev server ($(APPS))"
	@echo "make check            run every app's full pre-push gate"
	@echo "make hooks            turn the pre-push hooks on"
	@echo "make drift            check that node and pnpm agree across the repository"

hooks:
	git config core.hooksPath .githooks

install: hooks $(APPS:%=install-%)

$(APPS:%=install-%): install-%:
	pnpm -C apps/$* install --frozen-lockfile

test: $(APPS:%=test-%)

$(APPS:%=test-%): test-%:
	pnpm -C apps/$* $(unit_test_$*)

dev:
	pnpm -C apps/$(APP) dev

check: $(APPS:%=check-%)

# Each app's own hook, from inside the app, fed one push line: a real ref line
# whose local sha is HEAD, read here at run time (never at parse time, so the
# dry run shows `git rev-parse HEAD`, not a sha). A green hook is not enough:
# the output must show the lint stage, or the hook ran nothing.
$(APPS:%=check-%): check-%:
	@echo "▶ make check: apps/$*"
	@tmp=$$(mktemp -d); in='$(HOOK_STDIN)'; \
	if [ -z "$$in" ]; then \
	  in=$$tmp/push-line; \
	  echo "refs/heads/m269-check $$(git rev-parse HEAD) refs/heads/m269-check $(ZERO_SHA)" >"$$in"; \
	fi; \
	{ (cd apps/$* && ./.githooks/pre-push origin make-check <"$$in"; echo $$? >"$$tmp/rc") 2>&1; } | tee "$$tmp/log"; \
	rc=$$(cat "$$tmp/rc"); staged=0; grep -q '▶ pre-push: lint' "$$tmp/log" && staged=1; rm -rf "$$tmp"; \
	if [ "$$rc" != 0 ]; then echo "✖ make check: the apps/$* gate failed (exit $$rc)"; exit 1; fi; \
	if [ "$$staged" != 1 ]; then echo "✖ make check: apps/$* ran no gate stage, its hook saw no push line"; exit 1; fi

drift:
	@if [ -x scripts/check-env-drift.sh ]; then \
	  scripts/check-env-drift.sh; \
	else \
	  echo "✖ make drift: scripts/check-env-drift.sh is not in this tree"; exit 1; \
	fi
