/**
 * Unit tests for the Badge/Alert `success`/`warning` variants — the shared
 * "you're on track" vs "over" colour vocabulary (DESIGN.md §3/§7: green for
 * on-track, amber — never red — for over-goal). Both are plain `cva` functions,
 * so no rendering is needed to pin their class output.
 *
 * `warning` now speaks the amber TOKENS rather than Tailwind's amber palette
 * (DESIGN.md §11), which is why it no longer carries a `dark:` pair: the tokens
 * already resolve per theme in `app.css`, so a hard-coded dark override would
 * be a second, silently-diverging source of truth. Text and wash are separate
 * tokens on purpose — the light-theme text ochre is far too dark to double as
 * a fill; see the `--accent-amber-surface` note in `app.css`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { badgeVariants } from '../../app/components/ui/badge';
import { alertVariants } from '../../app/components/ui/alert';

describe('badgeVariants', () => {
  it('success uses the same green fill as the carb-status "low" tier', () => {
    const classes = badgeVariants({ variant: 'success' });
    assert.match(classes, /bg-green-100/);
    assert.match(classes, /text-green-800/);
    assert.match(classes, /dark:bg-green-900\/30/);
    assert.match(classes, /dark:text-green-400/);
  });

  it('warning uses the amber TOKEN, matching the over-goal signal (never red)', () => {
    const classes = badgeVariants({ variant: 'warning' });
    assert.match(classes, /text-accent-amber/);
    assert.match(classes, /bg-accent-amber-surface/, 'the wash is the surface token, never a palette literal');
    assert.doesNotMatch(classes, /amber-\d/, 'no raw Tailwind palette literals — tokens only (DESIGN.md §11)');
    assert.doesNotMatch(classes, /red/);
  });

  it('needs no dark: amber override — the token already resolves per theme', () => {
    // Scoped to amber: the shared base classes legitimately carry unrelated
    // `dark:` rules (the aria-invalid ring), so a bare /dark:/ check would fail
    // for a reason that has nothing to do with this variant.
    assert.doesNotMatch(badgeVariants({ variant: 'warning' }), /dark:[\w-]*amber/);
  });

  it('leaves the existing variants unchanged', () => {
    assert.match(badgeVariants({ variant: 'destructive' }), /bg-destructive/);
    assert.match(badgeVariants({ variant: 'outline' }), /text-foreground/);
    assert.match(badgeVariants({ variant: 'default' }), /bg-primary/);
  });
});

describe('alertVariants', () => {
  it('success/warning mirror the badge palette', () => {
    assert.match(alertVariants({ variant: 'success' }), /text-green-700/);
    assert.match(alertVariants({ variant: 'warning' }), /text-accent-amber/);
    assert.doesNotMatch(alertVariants({ variant: 'warning' }), /amber-\d/);
    assert.doesNotMatch(alertVariants({ variant: 'warning' }), /red/);
  });

  it('leaves the existing destructive variant unchanged', () => {
    assert.match(alertVariants({ variant: 'destructive' }), /text-red-700/);
  });
});
