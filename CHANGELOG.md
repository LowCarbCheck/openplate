# Changelog

All notable user-facing changes to openplate are recorded here.

## 0.10.0 - 2026-09-04

- You sign in with your email address and a password. The made up sign-in
  name is gone. An address is something you already know, and it is what a
  reset link is sent to.
- An invitation link asks for a password and nothing else. There is no
  recovery code to write down any more, and none is shown. The instance
  keeps the key that recovers your diary, which is what makes a password
  reset give your entries back instead of an empty account.
- A forgotten password is reset from the sign-in page. Ask for a link, open
  the mail, set a new password, and your diary is still there.
- You stay signed in after a reload. Closing the tab or restarting the
  browser no longer asks for your password again. It is still asked when
  you sign in, when you change your password, and when you delete your
  account.
- On an instance run for you by an organization, the photo estimate works
  as soon as you are signed in. There is no AI setup, no key to paste, and
  no separate connection step. Your daily allowance is shown on the account
  page.
- Administrators manage people at /admin: invite by email, see everyone
  with their allowance and what they have used today, change an allowance
  or a role, suspend and bring back, send a reset link, and delete an
  account.
- The account page moved from Settings, Sync to Settings, Account. The old
  address still works and sends you to the new one.

### Upgrading

- This version needs a server running openplate-sync 0.6.0 or later. Older
  servers do not have the new sign-in.
- The separate gateway is no longer used. Set INSTANCE_MODE=managed instead
  of GATEWAY_URL. Leaving GATEWAY_URL set now stops the app from starting,
  on purpose, so that a half migrated instance cannot run.
- Accounts from 0.9.x cannot be carried over. The identity model changed
  from a sign-in name to an email address, so people need a fresh
  invitation. Export a backup from each device before upgrading, and import
  it after signing in to the new account.

## 0.9.3 - 2026-09-04

- Invite links that create an account and connect the AI now run as one
  flow. Before, the app left the account screen too early. It never showed
  the recovery code, and the next screen asked you to sign in to the
  account you just created. The app now shows the account card with the
  sign-in name and recovery code. The AI connection follows once you
  confirm you saved the code.
- If the AI connection cannot be reached while the link is used, the link
  is kept and offered again. Before, a network error spent the link.

## 0.9.2 - 2026-09-04

- A failed save on the device no longer consumes the invite link. If
  saving the AI connection fails after the link is accepted, a retry card
  appears. Retrying saves the connection without using the link a second
  time, and reloading picks up where it left off.
- The AI connection now reaches the account even if the device saved it
  before the account did. The next sync carries it over.
- On a managed instance, a device without an AI connection no longer offers
  "Connect with OpenRouter". The scan card now says the invitation did not
  include photo recognition, and offers adding food without a photo.
- The sign-in step after an invite link now says the link belongs to an
  existing account, and that the rest is set up after signing in.

## 0.9.1 - 2026-09-03

- The camera opens on one tap from the tab bar. A chevron beside it opens a
  sheet with four ways in: plate photo, label photo, speak, and type.
- Speak on the add page turns your voice into search text. The first time
  you use it, a note tells you the browser sends the audio to Google or
  Apple.
- The scan setup card and the AI settings card are shorter now, and the
  connect card names who actually receives the photo.
- On a managed instance, the AI connection now travels inside the encrypted
  account data. Signing in on a new device brings the connection with it,
  and it is never included in a backup file.
- A gateway invite that gets refused is dropped from the tab, and the error
  card leads back into the app instead of a dead end.
- Managed instances (where the operator sets GATEWAY_URL) now offer one
  door in. The welcome screen offers only sign in or an invite link, there
  is no diary without an account, and the join link runs one uninterrupted
  ceremony with no skip. Settings no longer offer account creation.
  GATEWAY_URL also allow lists the gateway origin, so operators no longer
  need CSP_CONNECT_EXTRA for it. Open instances are unchanged.

## 0.9.0 - 2026-09-03

- One account instead of a "sync" passphrase. The app now speaks in terms of
  an account and a password, not a technical sync passphrase.
- A blank device now opens on a welcome screen, not the onboarding
  questionnaire. Returning users get a clear way in before the app assumes
  they are new.
- A dedicated sign-in route. Signing in now happens on its own page, and it
  waits for the first data pull to finish before handing control back to the
  app, so a returning user never lands on an empty screen.
- Signing out remembers the last name used on this device and shows a
  "Not you?" link to clear it, instead of forgetting who was signed in.
- Skipping a join link now leads to sign-in, so someone who already has an
  account is not pushed into creating a new one.

## 0.8.3 and earlier

See the annotated git tags (`git tag -l -n1`) for the release notes of each
earlier version.
