/**
 * THE TWO DOORS IN THE PUBLIC HEADER, and the one that must not appear
 * (M201 spec 03).
 *
 * The header is read as SOURCE rather than rendered, the trade
 * `managed-instance-copy.test.ts` documents: `public-wrapper.tsx` pulls in
 * react-i18next and a route loader hook, and a render harness would only cover
 * the branch a given render happened to take. There is no DOM test library in
 * this repo, so a source read anchored on the exact branch is what a wiring
 * claim can be.
 *
 * Three failures are being guarded against, and they run in different
 * directions:
 *
 *  1. THE MANAGED HEADER LOSES ITS DOOR. `/dashboard` bounces to `/welcome` on
 *     a managed instance, so a button named for a destination is a redirect
 *     wearing that name, and the page never says "sign in". That was the
 *     reported defect.
 *  2. THE OPEN HEADER GAINS ONE. A sign-in control on an instance with no
 *     accounts is the same fault mirrored: a control that cannot work. The
 *     open branch is pinned here by name for that reason, not for symmetry.
 *  3. THE NO-ACCOUNT DIALOG GROWS A FIELD. An address box would start a data
 *     collection with no notice covering it. Nothing would throw; the app
 *     would simply be gathering something nobody was told about.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import enCommon from '../../app/i18n/locales/en/common.json';

function readComponent(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../app/components/${name}`, import.meta.url)), 'utf8');
}

const HEADER = readComponent('public-wrapper.tsx');
const DIALOG = readComponent('invite-only-dialog.tsx');

describe('the public header on a managed instance', () => {
  it('reads the named policy question rather than the mode name', () => {
    // `managed === true` says nothing about why this corner cares, which is
    // the arrangement that let the deletion below outlive its premise.
    assert.match(HEADER, /const \{ headerOffersSignIn \} = useInstancePolicy\(\);/);
    assert.ok(!HEADER.includes('useManagedInstance'), 'the bare boolean hook is gone');
  });

  it('gives the header a sign in control pointing at the sign-in route', () => {
    assert.match(HEADER, /headerOffersSignIn \? '\/sign-in' : '\/dashboard'/);
    assert.match(HEADER, /headerOffersSignIn \? t\('chrome\.signIn'\) : t\('chrome\.openTracker'\)/);
  });

  it('offers the no-account path beside it, on the same question', () => {
    assert.match(HEADER, /\{headerOffersSignIn && <InviteOnlyDialog \/>\}/);
    assert.match(HEADER, /import \{ InviteOnlyDialog \} from '#app\/components\/invite-only-dialog';/);
  });
});

describe('the open instance header is unchanged', () => {
  it('still sends its one button to the tracker under its old label', () => {
    // The false branch of both ternaries above. Named separately so that
    // deleting it fails here rather than quietly on somebody's self-host.
    assert.ok(HEADER.includes("'/dashboard'"), 'the open destination');
    assert.ok(HEADER.includes("t('chrome.openTracker')"), 'the open label');
  });

  it('names sign in exactly once, and only on the managed branch', () => {
    // A second mention would be an unconditional one: the guard is the count,
    // because a `&&` added anywhere else in this file would still read fine.
    assert.equal(HEADER.split('chrome.signIn').length - 1, 1);
    assert.equal(HEADER.split('InviteOnlyDialog').length - 1, 2, 'one import, one guarded render');
  });
});

describe('the source icon left the header, and the footer link stayed', () => {
  it('carries no GitHub icon at all', () => {
    assert.ok(!HEADER.includes('Github'), 'the icon and its import are gone');
    assert.ok(!HEADER.includes('lucide-react'), 'and so is the icon package it came from');
  });

  it('keeps the footer Source link, which was always the labelled copy', () => {
    assert.ok(HEADER.includes("t('chrome.sourceShort')"), 'the footer word');
    assert.ok(HEADER.includes("title={t('chrome.source')}"), 'and its title');
    assert.equal(HEADER.split('REPO_URL').length - 1, 2, 'one import, one anchor, both in the footer');
  });
});

describe('the invite-only dialog collects nothing', () => {
  it('has no field of any kind in it', () => {
    // The whole rule, as a substring check: no element to type into, and no
    // mention of an address for one to hold.
    for (const forbidden of ['<input', '<Input', 'type="email"', 'email', 'Field', 'useForm']) {
      assert.ok(!DIALOG.includes(forbidden), `${forbidden} must not appear in the dialog`);
    }
  });

  it('is built from the one modal primitive the app already has', () => {
    assert.match(DIALOG, /from '#app\/components\/ui\/alert-dialog'/);
    assert.ok(!/from '[^']*ui\/dialog'/.test(DIALOG), 'no second modal primitive');
    assert.ok(!DIALOG.includes('createPortal'), 'and nothing hand-rolled');
  });

  it('says what it says through the catalog, never as a literal', () => {
    for (const key of ['requestAccess', 'requestAccessTitle', 'requestAccessBody', 'requestAccessClose']) {
      assert.ok(DIALOG.includes(`t('chrome.${key}')`), `chrome.${key} is rendered`);
    }
  });
});

describe('the header locale strings tell the truth before the click', () => {
  /** The English source strings this spec added, by the control they label. */
  const NEW_COPY = {
    'chrome.signIn': enCommon.chrome.signIn,
    'chrome.requestAccess': enCommon.chrome.requestAccess,
    'chrome.requestAccessTitle': enCommon.chrome.requestAccessTitle,
    'chrome.requestAccessBody': enCommon.chrome.requestAccessBody,
    'chrome.requestAccessClose': enCommon.chrome.requestAccessClose,
  };

  it('exists, in full', () => {
    for (const [key, text] of Object.entries(NEW_COPY)) {
      assert.ok(text.trim().length > 0, `${key} is empty`);
    }
  });

  it('never promises a signup an invite-only instance cannot honour', () => {
    // Four independent reviewers agreed the word is a false promise here. The
    // label is the affordance's whole contract, so the ban is on the copy.
    for (const [key, text] of Object.entries(NEW_COPY)) {
      assert.ok(!/sign ?up|create an account|register/i.test(text), `${key} promises a signup: ${text}`);
    }
  });

  it('names the person who can act on the request', () => {
    assert.match(enCommon.chrome.requestAccessBody, /administrator/i);
    assert.match(enCommon.chrome.requestAccessBody, /invit/i);
  });

  it('uses no em dash and no en dash', () => {
    for (const [key, text] of Object.entries(NEW_COPY)) {
      assert.ok(!/[–—]/.test(text), `${key} carries a dash: ${text}`);
    }
  });
});
