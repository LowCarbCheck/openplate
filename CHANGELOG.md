# Changelog

All notable user-facing changes to openplate are recorded here, newest version first. From 0.20.0
on, a version's changes are grouped under `### Added`, `### Changed`, `### Fixed` and `### Docs`,
in that order and only where there is content, and every bullet opens with a short bold lead
sentence. That lead is the line the GitHub Release page prints, so it is written as the sentence an
operator reads there. Older versions carry a single flat list. Every entry links the commit it came
from. The `## [Unreleased]` section holds merged work waiting for a release. The release commit
renames that heading to `## [x.y.z] - YYYY-MM-DD`, appends the commit links, and re-creates an empty
`## [Unreleased]` above it. See [`AGENTS.md`](./AGENTS.md), _Versioning and changelog_.

## [Unreleased]

### Added

- **The app now opens by asking how you eat, and every goal follows from that answer.** The first setup step lists five eating styles: low carb, low carb and calories, calories, high protein, and just track. Nothing is picked for you, and there is no Skip, because "just track" is the answer for anyone who wants no goal at all. A carb style then asks for a daily limit of 20, 50 or 100 g and a calorie style asks for a target, both required, so no goal is ever invented from a blank field. High protein sets your protein goal from your weight, and says so if there is no weight on file yet. If a pregnancy or a breastfeeding period is already recorded on the device, a note with a source link appears under the list for the three styles that restrict carbs or calories. The profile stores your pick from now on, so a backup taken from now on needs this version or newer to import; a profile written earlier keeps its numbers untouched and the app reads a style back out of them.
- **Goals in Settings lets you change your eating style later.** The page opens with a style card listing the same five styles. Saving keeps the numbers your style uses and clears the ones it does not, and the goal numbers below stay yours to fine tune afterwards. Re-saving the style you already have leaves your own numbers alone. The pregnancy and breastfeeding note appears here too, with no number changed.
- **A search that finds nothing now offers each part of it as a button.** Typing "Kaffee mit Hafermilch" searched the whole phrase, which no food database holds, and left you with nothing. When a search joins two foods with a word like mit, und, with or and, and finds no good match, the screen now offers "Kaffee" and "Hafermilch" as buttons that search each one on their own. A search that says what you did not eat, such as "Salat ohne Hähnchen", is never split.

### Changed

- **The day now gets one grade, the one your eating style asks for.** A low carb style still gets the carb verdict, a calorie style gets a calorie one, a high protein style gets its floor, and "just track" gets no grade at all. A day with no carb goal used to be graded against a hidden 50 gram line that was never shown to you. That line is gone.
- **The meal composer drops a notice nobody could read.** On an instance an organization runs, "Describe a meal" and "Add food" told a signed out visitor to sign in before the AI could read their words. Signing out closes both screens on that kind of instance, so the sentence was written for a screen that never opened. It is gone, and signing out still sends you to the welcome screen as before.

### Fixed

- **Goals in Settings shows the numbers a style save just wrote.** Saving an eating style cleared the goals it does not use, but the goal card underneath kept printing the old daily carb limit until you left the page and came back. Both cards now redraw from what is stored, in either direction: changing your goals also re-ticks the style card. Your eating style follows those numbers too. Setting a daily carb limit while your style was calories left the style card saying calories and the day graded on calories alone; the style now moves to the one your numbers describe. A high protein style stays as it is while its protein goal is still set, because a carb limit typed beside it is extra information, not a new goal.

## [0.23.3] - 2026-09-09

### Changed

- **The Today so far card lays every nutrient row out as a two column grid.** The value and its caption share one right edge, a hairline separates the rows, and a row with no target says so in words instead of drawing an empty meter. ([441f36e](https://github.com/LowCarbCheck/openplate/commit/441f36e))

## [0.23.2] - 2026-09-09

### Changed

- **A sentence with a drink and a named milk logs two foods.** "Kaffee mit Hafermilch" used to become one item that no food database holds, so the lookup showed a cow-milk coffee or nothing. The sentence path now lists the coffee and the oat milk as two items, each with its own lookup. A named single product such as a cappuccino stays one item. ([ee51b60](https://github.com/LowCarbCheck/openplate/commit/ee51b60))

## [0.23.1] - 2026-09-09

### Fixed

- **The scan review screen now shows a grams box you can type into.** After a label scan the portion chips only reached twice the estimate, and the free grams field was hidden inside the fine-tune panel, so there was no visible way to log 300 g. The grams box now sits under the chips with a minus and a plus button that move it 10 g at a time, and typing your own amount clears the chips. ([c1ae807](https://github.com/LowCarbCheck/openplate/commit/c1ae807))
- **The arm64 image builds again.** The Docker build installed the newest pnpm, which then downloaded the version the repo pins as a separate binary, and that binary has no arm64 alpine build. The build now installs the pinned version directly. ([360f6c0](https://github.com/LowCarbCheck/openplate/commit/360f6c0))

## [0.23.0] - 2026-09-09

### Added

- **You can record a due date or a birth date, and anyone can be asked.** Choosing Pregnant on your goals page now reveals a due-date field, with a "weeks along" box that fills it in for you, and choosing Breastfeeding reveals the birth date. Under the field, one line says which trimester and week, or how many months of breastfeeding, that date means today. Both are optional, both can be cleared, and the question is now put to everyone who did not answer Male, including anyone who preferred not to say. The onboarding step asks the same way. ([9615f29](https://github.com/LowCarbCheck/openplate/commit/9615f29))

### Changed

- **Pregnancy and breastfeeding targets now follow your stage.** The protein reference used to add the third trimester figure to every pregnancy. With a due date or a birth date on file, it now adds the figure for the trimester or the month you are in, and it adds the matching energy figure to a calorie target you set yourself. Your stored target is untouched. Without a date, the app still uses the largest figure, and the day view says so with a link to your goals. ([e350876](https://github.com/LowCarbCheck/openplate/commit/e350876))

## [0.22.2] - 2026-09-09

### Fixed

- **A release now publishes the amd64 image even when arm64 fails.** The two architectures build separately, and until now one broken build left the whole version untagged in the registry, so an x86_64 host had nothing to pull. The run says in its log which platforms the published tag carries. ([a28ea2e](https://github.com/LowCarbCheck/openplate/commit/a28ea2e))

## [0.22.1] - 2026-09-09

### Fixed

- **Releases no longer hang building the arm64 image.** The arm64 half was emulated on an x86 runner, and when that emulator crashed the whole release published no image for either architecture, so each architecture now builds on a machine of its own. ([7948355](https://github.com/LowCarbCheck/openplate/commit/7948355))

## [0.22.0] - 2026-09-09

### Added

- **The protein row shows a reference floor when you set no goal.** It appears on the dashboard and in the diary, with the same small "reference" tag as the fiber row. The figure is EFSA's population reference intake. It uses 0.83 g of protein per kilogram of body weight from your latest weigh-in. Without a weigh-in, it uses your height and sex. It falls back to 50 g when the app knows neither. Pregnancy adds 28 g, and breastfeeding adds 19 g. A goal you set yourself always wins. ([3f3c66f](https://github.com/LowCarbCheck/openplate/commit/3f3c66f))

### Changed

- **Food suggestions for an open gap change from day to day.** The suggestions for an open protein or fiber gap now vary with the date. A food you already logged today is not suggested again. ([1881eaf](https://github.com/LowCarbCheck/openplate/commit/1881eaf))

## [0.21.0] - 2026-09-09

### Added

- **Today's budget rows show fat, in grams.** On the dashboard and in the diary, fat sits between protein and fiber. Fat has no target. ([89324a5](https://github.com/LowCarbCheck/openplate/commit/89324a5))

### Changed

- **The message box at /describe looks like a chat.** One rounded box that grows as you write, with a round Send button inside it. Enter still sends, and Shift and Enter still start a new line. ([ff80af4](https://github.com/LowCarbCheck/openplate/commit/ff80af4))
- **The app's own microphone button is gone.** On a phone it did nothing, and it sent your voice to Google or Apple through the browser. Speak now opens the message box with the field focused. Tap the microphone key on your keyboard to dictate, then send. ([ff80af4](https://github.com/LowCarbCheck/openplate/commit/ff80af4))

## [0.20.1] - 2026-09-08

### Added

- **The review screen shows the words you sent.** After a typed or spoken meal, the words sit above the food list so you can check the estimate against them. ([860ae43](https://github.com/LowCarbCheck/openplate/commit/860ae43))

### Fixed

- **A managed instance can describe a meal with AI.** The message box at /describe and the "Log with AI" button on the search page were always disabled there, because both only looked for an AI key stored on the device, and a managed instance keeps none. Both now ask the same question the scan screen asks: signed in, with an AI allowance. The notice for a person without AI names the right door: sign in on a managed instance, connect a provider on an open one, or ask the administrator when the account has no allowance. ([860ae43](https://github.com/LowCarbCheck/openplate/commit/860ae43))

## [0.20.0] - 2026-09-08

### Added

- **Type and Speak open a message box at /describe.** Write or say what you ate, send it, and the AI works out the food from your words the same way it does from a photo, on the same review screen, into the same diary. The launcher sheet, the dashboard, the diary's empty states and the first-run lesson all lead there. The food database search stays at /add for one exact item. ([d021dc9](https://github.com/LowCarbCheck/openplate/commit/d021dc9))
- **Administrators get a Reports tab.** It lists every reported estimate, when it arrived and when it deletes itself, and opens one report with the model's figures and the photo, if there was one. A report can be deleted now instead of at the end of the window. ([e6cf401](https://github.com/LowCarbCheck/openplate/commit/e6cf401))

### Changed

- **The scan messages name a description, not a photo.** When you described the meal in words, the waiting text, the "nothing found" text and the failure text each have a version for a description. ([d021dc9](https://github.com/LowCarbCheck/openplate/commit/d021dc9))
- **A managed instance no longer says the diary is only on this device.** The offline page and the data settings say instead that the server holds an encrypted copy it cannot read. ([660e83a](https://github.com/LowCarbCheck/openplate/commit/660e83a))

### Fixed

- **A scanned plate photo is saved on this device when you confirm.** It never was: the save waited for a page state that a local save never produces. The device copy the AI settings promise is now kept, and a report of a bad estimate can carry the picture. ([83da248](https://github.com/LowCarbCheck/openplate/commit/83da248))

## [0.19.1] - 2026-09-08

- On a managed instance the page title, the footer, the front page and the
  recovery screen no longer say the diary stays only on this device. The
  account keeps an encrypted copy on the operator's server, so the copy now
  says what is still true there: only you can read it. The recovery screen
  offers a sign-in link, because on such an instance signing in is what
  brings the diary back. Nothing changes on an open instance.

## [0.19.0] - 2026-09-08

- The diary and the overview show the day as budget rows for net carbs,
  calories, protein and fiber instead of ring charts. The day's details sit
  inline, and suggestions fold into one line you can open.
- One way in for a meal. A photo is one task, and the model decides whether
  it is looking at a plate or a nutrition label, so the separate label mode is
  gone. A typed or spoken meal goes through the same AI review screen as a
  photo. For speech, the browser's own engine transcribes; only the text
  reaches openplate and the provider, and the consent copy says so. The first
  run lessons were rewritten to match.
- The app knows which build it is running. The About page has an Updates
  section, the sidebar shows the build, and the server checks GitHub for a
  newer tag every six hours (set UPDATE_CHECK=off to stop that). When one
  exists a ribbon says so, and the service worker adopts the newest bundle.
- The sign-in hint from 0.18.4 is unchanged; the version shown in the app now
  comes from the build itself rather than a hand-copied constant.

## [0.18.4] - 2026-09-08

- The sign-in form now says plainly that you sign in with the email address
  your account was created with, and that capital letters in it do not
  matter. The error after a rejected sign-in said "sign-in name", a leftover
  from a version where accounts had a chosen name. There is no username; the
  address is the only identifier.

## [0.18.3] - 2026-09-08

- A sign-in form submitted before the page had finished loading was sent as
  a plain page request, so the password could land in the address bar and in
  the browser history. The sign-in, reset and study forms now keep their
  submit button disabled until the page is ready.

## [0.18.2] - 2026-09-08

- The device menu in the header now offers a way to sign in when you are
  signed out. On an instance where anybody can make an account it offered only
  "Create account", so somebody who already had one, and had been signed out,
  had no way back in from that menu. It now shows both, sign in first. This
  never affected the hosted instance, where the menu already said "Sign in".

## [0.18.1] - 2026-09-08

- Punctuation only. The terms, the privacy policy and the age range labels used
  long dashes, which the project's own writing rules ban. They are now full
  stops, commas, colons or brackets. No wording changed, so nothing either
  document says has changed.

## [0.18.0] - 2026-09-08

- The lesson after the first run now tells you that openplate installs on a
  phone, where it opens like any other app. Previously, desktop browsers said
  nothing, and only browsers that supported one-tap install showed the notice.
  You now learn that the app installs, whichever browser you use, and you still
  get the install button or the iPhone steps where those work.

- For administrators, the console at /admin now divides into three tabs:
  People, Invitations and Activity. The People list includes a search box and a
  filter for active, suspended and administrators. Each row is compact, shows
  the last seven days of photo reads, and opens a page for that person. The
  buttons that change an allowance, send a reset link, suspend or delete now
  live on this person page, which keeps the main list clean. The new Activity
  tab lists everybody by who was here last, over seven, thirty or ninety days.

## [0.17.0] - 2026-09-08

- A meal you photograph now goes into breakfast, lunch, dinner or snack, the
  same as one you type in. The meal is chosen from the time the photo was
  taken, not the time you get around to confirming it, and you can change it
  before you log. Every food on the plate goes into the same meal. Photographed
  meals used to land outside the meal groups in your diary, and the only way to
  fix that was to open each entry afterwards.

## [0.16.0] - 2026-09-08

- Fixed a bug that signed people out without warning. The app renews your
  sign-in in the background, but it failed to save the renewed one, so the next
  time you opened the app it presented a sign-in the server had already
  retired. That triggered a security check that signed you out on all your
  devices. If this happened to you, you will need to sign in once more after
  updating, and then the sign-outs stop.

- When you are signed out of an account you were invited to, the photo scan
  screen now says you are signed out and lets you sign back in. It used to
  claim that photo estimates were turned off and told you to contact an
  administrator, which was incorrect. If your account actually does not have
  photo estimates, it still displays that notice.

- If you get signed out while using the app, openplate now tells you right
  away, instead of leaving your food diary on the screen as if you were still
  signed in.

- The setup screen on your first visit now shows you how to install openplate
  on your phone, alongside the three ways to log a food. This instruction was
  only in settings before.

## [0.15.0] - 2026-09-08

This release is about instances that an organization runs and invites people
to. If you self-host openplate for yourself, nothing here changes for you.

- Signing out is now one tap from the menu at the top right, instead of being
  the last button in the danger zone of the account screen, next to "delete
  account". After you sign out, this device no longer shows the diary, and
  reloading the page no longer puts you back in it as though you were still
  signed in.

- You can also erase the diary from the device as you sign out. It is a
  checkbox, off unless you tick it, and it tells you first how many entries
  have not reached the server yet, because erasing loses those.

- On an instance you need an invitation for, the front page now says so. There
  is a "sign in" button where there used to be only a link to the source code,
  and a "request access" button that explains an administrator issues the
  invitations. The rest of that page no longer offers a free trial, an account
  you can create yourself, or an AI key you bring, because none of those exist
  on an instance like that.

- Administrators can open a person in the admin console and see when they last
  signed in and how many photos were read for them on each of the last ninety
  days. Daily counts older than ninety days are deleted.

- If you use an instance somebody else runs, your account screen now lists
  exactly what its administrator can see about you, and what they cannot. Your
  diary is encrypted on this device before any copy of it leaves, so it is not
  on those pages.

## [0.14.0] - 2026-09-07

- If a photo estimate comes out wrong, you can now tell us. There is a button at
  the bottom of a logged entry. It asks you to agree first, in a separate step
  that says exactly what is sent, who can look at it, and how long it is kept,
  and it has a plain "no, do not send" beside the agree button. If the entry has
  no photo, it says so and sends only the figures. If you never report an entry,
  we never receive a photo.
- The privacy policy now says all of that, in both languages. It used to say
  your on-device photo copy "is never uploaded anywhere", in five places. That
  is no longer true once you can report an entry, so every one of those
  sentences was rewritten to say what actually happens rather than deleted.
- A report waits if you are offline and sends when you are back. Reporting the
  same entry twice creates one report, not two.
- How long a report is kept is set by whoever runs the sync server you use, and
  the app now asks that server and shows its real answer. If the server does not
  say, the app does not offer to report at all rather than promise you a number
  nobody is keeping.

## [0.13.0] - 2026-09-07

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

## [0.12.0] - 2026-09-07

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

## [0.11.1] - 2026-09-07

- Clarified in the architecture and topology guides that the food source is
  configurable. The bundled USDA FoodData Central extract is the default, not
  the only option. Updated the label inside the rung 3 diagram to match.
- Updated the architecture guide to clarify numeric output rules. The language
  model generates gram estimates, but it never authors macro numbers. The
  documentation now states this rule directly.

## [0.11.0] - 2026-09-07

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

## [0.10.3] - 2026-09-06

- On an instance run for you by an organization, the app now says what that
  operator can see. A plate photo passes through the operator's server on its
  way to the AI, the AI key is the operator's, every user has an invited
  account, and the operator holds a recovery key. The landing page, the first
  onboarding screen, the terms and the privacy policy said the opposite; they
  described an instance you run alone. An instance you run yourself keeps the
  old wording, which is true there.
- The AI provider settings page is closed on such an instance. It described a
  key nobody brings there.

## [0.10.2] - 2026-09-05

- Search engines no longer index the app. The project site at openplate.de
  describes openplate instead, and it is the page a search should lead to. An
  instance you run yourself is your own tool, so it stays out of results too.
- The sign-in screen no longer claims you are asked for your password again
  after every reload. You have stayed signed in until you sign out since
  0.10.0; only the text still said otherwise.

## [0.10.1] - 2026-09-04

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

## [0.10.0] - 2026-09-04

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

## [0.9.3] - 2026-09-04

- Invite links that create an account and connect the AI now run as one
  flow. Before, the app left the account screen too early. It never showed
  the recovery code, and the next screen asked you to sign in to the
  account you just created. The app now shows the account card with the
  sign-in name and recovery code. The AI connection follows once you
  confirm you saved the code.
- If the AI connection cannot be reached while the link is used, the link
  is kept and offered again. Before, a network error spent the link.

## [0.9.2] - 2026-09-04

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

## [0.9.1] - 2026-09-03

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

## [0.9.0] - 2026-09-03

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
