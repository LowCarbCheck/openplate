/**
 * Where the keyboard is when the sign-out dialog opens and when it closes.
 *
 * ── The defect this file encodes ─────────────────────────────────────────
 *
 * The one sign-out dialog is mounted in the root and opened by a function call
 * (`openSignOutDialog()`), so it has no Radix Trigger. Radix returns focus to
 * the trigger when a dialog closes, and with none it returned it to nothing:
 * press Enter on the settings page's sign-out button, press Escape, and the
 * keyboard was back at the top of the document. The host now records the
 * element that was focused when a door opened the dialog, and gives focus back
 * to it, or to the avatar trigger when that element is gone (a menu row that
 * closed with its menu).
 *
 * ── The three checks of the menu guard's removal ─────────────────────────
 *
 * `avatar-menu.tsx` used to keep the menu from returning focus to its trigger
 * while the dialog was open (`onCloseAutoFocus` and `preventDefault`), so the
 * menu could not fight the dialog's focus trap or leave `pointer-events: none`
 * on the body. The dialog host now owns focus in both directions, and the
 * three checks below are what held the guard in place (F2): focus lands inside
 * the dialog after a keyboard choice in the menu, the body takes clicks after a
 * Cancel, and focus goes back to the avatar trigger.
 *
 * ── Controls ─────────────────────────────────────────────────────────────
 *
 * Each "focus is here" claim has its other side: before the dialog opens the
 * focused element is outside it, and the two doors end on two different
 * elements, so a host that always focused one fixed element fails one of them.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { E2E_ACCOUNT_EMAIL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import { settleAnimations } from './layout-shift';

/** The header's avatar button, the menu's trigger. */
function avatarTrigger(page: Page): Locator {
  return page.locator('header [data-slot="avatar-menu-trigger"]');
}

/** The sign-out row of the header menu, found by its icon as the sibling specs do. */
function menuSignOutRow(page: Page): Locator {
  return page.getByRole('menuitem').filter({ has: page.locator('svg.lucide-log-out') });
}

/** The settings page's sign-out button, found by its icon. */
function settingsSignOutButton(page: Page): Locator {
  return page.locator('main button:has(svg.lucide-log-out)').first();
}

/** Whether the focused element is inside the open alert dialog. */
async function isFocusInsideTheDialog(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="alertdialog"]');
    return dialog !== null && dialog.contains(document.activeElement);
  });
}

/** Opens the header menu with the keyboard and chooses the sign-out row with Enter. */
async function chooseSignOutInTheMenuByKeyboard(page: Page): Promise<void> {
  await avatarTrigger(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await menuSignOutRow(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await settleAnimations(page);
}

test('Escape from the dialog the settings button opened puts focus back on that button', async ({ page }) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await page.goto('/settings/account');
  await expect(page.getByText(E2E_ACCOUNT_EMAIL).first()).toBeVisible();

  const button = settingsSignOutButton(page);
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await settleAnimations(page);
  // CONTROL: the keyboard is in the dialog while it is open, so the focus that
  // comes back is a return and not a button that never lost it.
  expect(await isFocusInsideTheDialog(page), 'focus is inside the open dialog').toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('Escape from the dialog the header menu opened puts focus on the avatar trigger', async ({ page }) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);

  await chooseSignOutInTheMenuByKeyboard(page);
  // F2 (1): the menu's own focus return does not pull the keyboard out of the dialog.
  expect(await isFocusInsideTheDialog(page), 'focus is inside the dialog after a keyboard choice').toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  // The row that opened the dialog went with its menu, so the trigger is the
  // place focus comes back to. The settings test ends on a different element.
  await expect(avatarTrigger(page)).toBeFocused();
});

test('a cancelled dialog leaves the body clickable and the avatar menu openable', async ({ page }) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);

  await chooseSignOutInTheMenuByKeyboard(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // F2 (2): the body takes clicks, and a click on the avatar opens the menu.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe('none');
  await avatarTrigger(page).click();
  await expect(page.getByRole('menu')).toBeVisible();
});
