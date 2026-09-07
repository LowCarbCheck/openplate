# Changelog

All notable user-facing changes to openplate are recorded here.

## 0.13.0 - 2026-09-07

- The first run now teaches. The last step of setup shows the three ways to get
  food into your diary, one card each, and every card starts the real thing
  rather than showing you a demo of it. It is still skippable, and setup did not
  get any longer. The drawings hold still if your system asks for reduced
  motion.
- You can track net carbs and calories at the same time. Setup used to make you
  pick one. Now each goal you set draws its own ring on the overview and in the
  diary, and if you set only one it looks exactly as it did before. "Just the
  habit" is still there for anybody who wants a streak and no daily number.
- The suggested daily protein amount is now worked out from your height and sex
  instead of your body weight. A target scaled by total weight climbs as your
  weight does, which is the opposite of what that number is for. The screen says
  which method produced the figure and calls it an estimate. If you have not
  entered a height or a sex, it says so and falls back to the old suggestion
  rather than inventing one.
- The two camera buttons now say what they photograph. One reads "Photograph
  your plate", the other "Photograph a nutrition panel". Reading the printed
  panel on a package has worked for a long time, but the button said "Label
  photo", which never said what it was for, so people did not know the feature
  was there. The same button in the add-food sheet said the same thing and has
  been fixed too.
- The app records which features get used, behind a level the operator of your
  instance sets. It never records anything from your diary. See the privacy
  page for what is counted and what is not.
- The openplate mark is now installed from the brand repository rather than
  being kept by hand, and a local check re-hashes it, so a hand-edited icon
  cannot ship by accident.

## 0.12.0 - 2026-09-07

- The sidebar and the mobile drawer now link to the administrator area for the
  accounts that have one. The page existed before, but only somebody who
  already knew the address could reach it.
- The drawing at the top of the architecture guide is simpler. It was five
  boxes, a box inside a box and seven arrows, three of them dotted exceptions.
  It is now the app server, your device, and the two things that leave your
  device: the diary, encrypted, and the plate photo. The cases that used to be
  dotted arrows, a cloud provider, your own inference box, and a managed
  instance, are named in the paragraph under the drawing, and the topology
  guide draws each of them on its own.

## 0.11.1 - 2026-09-07

- Clarified in the architecture and topology guides that the food source is
  configurable. The bundled USDA FoodData Central extract is the default, not
  the only option. Updated the label inside the rung 3 diagram to match.
- Updated the architecture guide to clarify numeric output rules. The language
  model generates gram estimates, but it never authors macro numbers. The
  documentation now states this rule directly.

## 0.11.0 - 2026-09-07

- Adding food inside the app now opens the camera directly on tap, matching the
  tab bar button. Typing and speaking sit beside it as dedicated buttons
  instead of a small link. On a device without an AI provider connected, the
  tap still opens the scan screen to explain what to connect, so it never asks
  for a camera permission the device cannot use. A photo taken while viewing an
  earlier day logs to that day, not to today.
- Changed the final onboarding step to lead with "Photograph food", and moved
  the search button beside it. Ending the first run on "Find a food"
  contradicted what every add-food screen does later. The button now uses the
  same label shown in the diary and the dashboard.
- The architecture and topology guides now include diagrams. The topology
  drawing shows which arrows leaving your device carry a photo and which carry
  ciphertext, so the claim the project rests on is visible without reading six
  sections first.
- The architecture guide no longer contradicts itself about accounts. One
  section previously stated the sync server was the only component that needed
  an account, while the same section stated the study console keeps its own.
- The published guides were reworded to remove every em dash and en dash. No
  claim changed.
- A script now captures the product screenshots on the landing page in German
  and in English, so they can be regenerated when a screen changes.

## 0.10.3 - 2026-09-06

- On an instance run for you by an organization, the app now says what that
  operator can see. A plate photo passes through the operator's server on its
  way to the AI, the AI key is the operator's, every user has an invited
  account, and the operator holds a recovery key. The landing page, the first
  onboarding screen, the terms and the privacy policy said the opposite; they
  described an instance you run alone. An instance you run yourself keeps the
  old wording, which is true there.
- The AI provider settings page is closed on such an instance. It described a
  key nobody brings there.

## 0.10.2 - 2026-09-05

- Search engines no longer index the app. The project site at openplate.de
  describes openplate instead, and it is the page a search should lead to. An
  instance you run yourself is your own tool, so it stays out of results too.
- The sign-in screen no longer claims you are asked for your password again
  after every reload. You have stayed signed in until you sign out since
  0.10.0; only the text still said otherwise.

## 0.10.1 - 2026-09-04

- You stay signed in when you open the app again. After following an
  invitation, opening any page in a new tab showed the sign-in screen and
  offered to sign you in to the account you were already using. The app now
  waits for your session to open before it decides where to send you.
- An invitation now lands you in the app. It used to finish on the public
  home page, which describes the app to somebody who does not have it yet.
- The invitation screen no longer shows the code from your link. It asked you
  to look at a long string you did not type, could not check and should not
  change. It now asks for a password and nothing else. If the link turns out
  to be dead, the field appears so you can paste another one.
- A photo estimate that fails now says why, in one sentence. It used to fail
  in silence: nothing on screen, and the same photo sent twice. A photo that
  is too large, a used up daily allowance, an account with no allowance and a
  suspended account each say what they are and what to do.
- Your account page shows how many photo estimates you have used today, and
  how many you have.
- After a password reset you land in your diary, with your entries already
  there. The reset used to finish on the public home page before your diary had
  been downloaded, so an account with months of entries was shown the first run
  questionnaire.
- Administrators can reach the administration pages again after resetting
  their password. The page used to say they were not an administrator,
  without checking their role.
- Fixed an issue where opening the app in two places right after a password
  reset could sign you out again.

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
