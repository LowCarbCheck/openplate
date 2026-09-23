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

- **A page at `/privacy/website` carries the website's own privacy text.** It is read from the same mounted folder as the other legal pages, so openplate.de can link to it and keep no legal text of its own. ([7656051](https://github.com/LowCarbCheck/openplate/commit/7656051))

### Changed

- **The legal pages come from a folder you mount, and openplate ships none of its own.** The terms, the privacy policy, the imprint, the withdrawal page and the two pages to cancel or withdraw from a contract are now markdown files in the folder `CONTENT_DIR` names, one file per page and language, with English as the fallback. Without the variable these pages answer "not found" and the footer shows no legal links. A file that breaks the format is refused and logged with its line numbers, and its page shows an error instead of part of the text. The two statutory forms work as before; only their text moved into the files. `PLAN_PRICE_EUR` and `PLAN_TRIAL_DAYS` are no longer read. ([7656051](https://github.com/LowCarbCheck/openplate/commit/7656051))

### Docs

- **A guide to the content folder.** [docs/content.md](docs/content.md) describes the folder layout, the file format, what the app refuses and the named sections of the two statutory pages, for anyone who runs their own instance. ([7656051](https://github.com/LowCarbCheck/openplate/commit/7656051))

## [0.40.0] - 2026-09-23

### Added

- **You can pick a main goal, the number the diary shows first.** Eating and targets in settings has a new Main goal card with three choices: net carbs, calories or protein. The first-run questions ask the same thing once a style is picked, already set to the one your style suggests. The choice only decides which figure leads the diary's day card; the dashboard, the trends and the day's verdict stay as they are. Picking calories without a calorie target is allowed: the card says so, and the diary shows the day's calories with a link to set a target. The choice is stored in your profile and travels in your backup and in sync. An older openplate on another device ignores it and may drop it, and the diary then goes back to following your eating style. ([9f8557f](https://github.com/LowCarbCheck/openplate/commit/9f8557f)) ([71442d1](https://github.com/LowCarbCheck/openplate/commit/71442d1))

### Changed

- **The page title on a phone is larger and sits closer to the brand name.** The title in the phone header is now 18 px instead of 14 px, with 4 px between it and the openplate wordmark above it instead of 6 px. The size is fixed: a title that does not fit is shortened in its translation, not shrunk. The thirteen titles in German, English, Spanish, French and Italian that first ended in an ellipsis at the new size are now shortened, and the research page's own title, "Research contributions", is now "Research studies" to match what the page is about. ([c6771ff](https://github.com/LowCarbCheck/openplate/commit/c6771ff)) ([e3cbcff](https://github.com/LowCarbCheck/openplate/commit/e3cbcff))
- **Every corner in the app is square now, except a real circle.** Cards, buttons, inputs, selects, dialogs, sheets, menus, badges, chips, images, progress bars and the header and bottom bar all lost their rounded corners. An avatar, a status dot, a round icon button, a switch and a spinner stay round, because they are circles by design and not because of where they sit. ([65812ef](https://github.com/LowCarbCheck/openplate/commit/65812ef))
- **The diary day card leads with one large figure.** The top of the card now shows one number large, what you ate against its target, for example "25.1 / 50 g", with a thick bar under it and a quiet line saying what is left. The other figures follow as a quiet list, each with its amount against its target and a thin bar. Which figure leads is your main goal, and until you pick one it follows your eating style: net carbs for the carb styles and for just tracking, calories for the calorie style, protein for the high-protein style. A lead with no target shows the day's total, no bar, and a link to set a target, and a protein lead on the reference intake says that it is a reference. The dashboard and the catch-up screen keep their rows as they were. ([bd0d0a5](https://github.com/LowCarbCheck/openplate/commit/bd0d0a5))
- **The loading screen shows the openplate name instead of three dots.** The app icon now stands still, and under it the word openplate is written the way the header writes it. "open" stays teal, and the teal runs through "plate" one letter at a time and back while the app starts. With reduced motion turned on in the system settings, the word does not move. Screen readers still hear only the loading label, not the letters. ([a28cd4e](https://github.com/LowCarbCheck/openplate/commit/a28cd4e))

### Fixed

- **Nothing moves on the first-run questions when you pick or type.** Picking a carb limit showed its description line only after the pick, so the Continue button dropped 24 px; the line now holds its space from the start. A picked chip was 8 px wider than the others, which pushed the kg and lb toggle and the sex and allergy chips sideways; every chip now keeps one width. Typing the week of a pregnancy turned a two-line note into one line and lifted everything under it by 16 px; the note now keeps its height. The same note on the Life phase settings page keeps its height too. ([71442d1](https://github.com/LowCarbCheck/openplate/commit/71442d1))

## [0.39.0] - 2026-09-22

### Added

- **A usual meal now asks you to confirm the portion before logging it.** Tapping a chip under "Your usual breakfast" (or lunch, dinner, snack) on Add or Scan opens a dialog naming the food, and for a saved meal, how many items, with a stepper to scale the portion from 50% to 200% before it is added, rather than logging the exact recorded amount straight away. Cancel closes the dialog with no write, and the confirmation that appears once you add it is unchanged. ([6cc400c](https://github.com/LowCarbCheck/openplate/commit/6cc400c))
- **You can list your food allergies, on day one or later in settings.** The About you page and the body step of the first-run questionnaire carry the same fourteen chips, one for each allergen an EU food label must declare: gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin and molluscs. The list is stored on this device beside the rest of your profile, travels in your backup file and in encrypted sync like every other profile field, and is never sent to an AI provider or anywhere else. A sentence under the chips says what the list is not: openplate checks only foods it recognised from a photo or a description, it can miss hidden ingredients, and it is not a safety check. The chips themselves become visible notes on foods in a later release. The backup format moves to version 24; an older openplate refuses a backup taken by this one, as before. ([07631cb](https://github.com/LowCarbCheck/openplate/commit/07631cb))
- **Foods you photograph or describe now carry small notes for pregnancy, breastfeeding and your allergies.** When the AI reads a plate or a sentence, it also says which foods fall into the categories the NHS, the BfR and the ACOG agree on for pregnancy, such as raw milk, soft cheese, raw egg or fish, raw or cured meat, cold-smoked fish, high-mercury fish, liver, alcohol, caffeine and raw sprouts, and which of the fourteen EU allergens a food contains or may contain. Nothing about you is sent with the photo: the app on your device compares those answers with your life phase and your allergy list and draws a small chip beside the food, in the review before you confirm, on the diary card and on the entry page. Pregnant shows every category, breastfeeding shows alcohol, caffeine and high-mercury fish, and an allergy chip shows for anyone who listed that allergen. The chip is a note, not a block: it opens nothing and stops nothing, caffeine reads as a reminder that it counts toward 200 mg a day, and a doubt is worded as a doubt, may be unpasteurised, may contain milk. The raw answers are kept on the entry, so changing your life phase or your allergy list re-evaluates every old entry at once, and they travel in your backup and in sync. Foods added from the search carry no such note yet. The Life phase settings page says where the hints come from and that they do not replace advice from your midwife or doctor. The backup format stays at version 24. ([2d206f9](https://github.com/LowCarbCheck/openplate/commit/2d206f9)) ([a8f3b48](https://github.com/LowCarbCheck/openplate/commit/a8f3b48))

### Changed

- **Add, Scan and Describe now nest under one address, /add.** /add is now the database search, at /add/search. /scan, the camera and the photo review, is now /add/photo. /describe, the message composer, is now /add/describe. The old addresses still work, each one redirects to its new home, so a bookmark, a home screen shortcut, or an installed app's stale link all keep working. ([16db3e2](https://github.com/LowCarbCheck/openplate/commit/16db3e2))
- **"What you ate" on the diary now states each macro as a share of the day, not a second gram figure.** The rows at the top of the day card already say how much protein, fat and fiber you ate and how that sits against your goal. The block under them repeated those same grams a second time with nothing beside them, so the card read as two blocks saying almost the same thing. Those four cells now give each macro's share of the day, the same percentages the coloured bar directly above them draws, so the rows answer how much and the block answers what shape the day had. No figure was lost: every gram count still has its own row. ([7e514c6](https://github.com/LowCarbCheck/openplate/commit/7e514c6))
- **Trends now uses a two-column layout on wide screens.** Charts show grid lines and axis numbers, and tapping or hovering a bar, slot or macro segment displays its exact value. Metric and meal filters now sit as dropdowns in a single row beside the time range switch, instead of three rows of chips. ([d844919](https://github.com/LowCarbCheck/openplate/commit/d844919))

### Fixed

- **The name openplate no longer sits on top of the page title on a phone.** The small brand name and the name of the page you are on were less than two pixels apart in the bar at the top of every screen, so the two lines read as one block and you could not tell them apart at a glance. They now stand six pixels apart. The bar is the same height, the page title is the same size, and nothing else on the bar moved. ([5c86ca1](https://github.com/LowCarbCheck/openplate/commit/5c86ca1))
- **The AI settings page keeps its explanations folded away until you ask for them.** The page ended with about ten paragraphs of grey text, all open, which pushed the Save button off the bottom of a phone. The two reference blocks, what this is for and what to try when a scan fails, are now closed panels that open when you tap their heading. Nothing was removed, and the setup steps, the provider choice, the models and the key field are all still where they were. ([cdc2992](https://github.com/LowCarbCheck/openplate/commit/cdc2992))
- **Your usual meals now stand out from the list of recently logged foods.** The chips under "Your usual breakfast" were drawn in the same card surface as the rows under them, so the one tap that saves you a search looked lighter than the list it sits above. Those chips are now filled, and a food's calories moved onto the same line as its badges, so a recent food is two lines instead of three and the whole list is shorter. How often you logged a food now reads as a small filled figure instead of the quietest grey on the row. ([cdc2992](https://github.com/LowCarbCheck/openplate/commit/cdc2992))
- **Your record tells a three day streak from a hundred day one at a glance.** Every row on the record page looked the same whatever it stood for. The two streak families are ladders, so each of their rows now prints the number of days it asks for, down the left of the title. The badges for trying a function have no day count and print none. ([cdc2992](https://github.com/LowCarbCheck/openplate/commit/cdc2992))
- **The first screen now carries the openplate mark and name.** The screen a new device opens on, the one that offers to start a diary or sign in, was a card with a headline and two buttons on an otherwise blank background, and nothing on it said which app you had opened. It now carries the app mark and the name above the card, the same pair the questionnaire on the very next screen has always shown, and the two are centred together. ([7b49fdf](https://github.com/LowCarbCheck/openplate/commit/7b49fdf))
- **Saved meals now tells you where the next one comes from.** The page explained how to save a meal only when you had none, which is the one moment you cannot act on it. The sentence now sits at the foot of the page whenever you have saved meals too, so a list of three no longer ends halfway down the screen with nothing under it. ([7b49fdf](https://github.com/LowCarbCheck/openplate/commit/7b49fdf))
- **Describe now puts the message box at the bottom of the page.** The box was pinned to a fixed share of the window rather than to the room the page was given, so on a phone it stopped short and left a band of empty space beneath it. It now reaches the bottom of the page above the navigation bar, on a tall screen and on the short one a raised keyboard leaves. ([7b49fdf](https://github.com/LowCarbCheck/openplate/commit/7b49fdf))
- **Notifications now shows tomorrow's message even when you cannot turn notifications on.** The page exists so that nobody agrees to a notification without reading one first, and the preview was shown only to people who had already agreed. If your browser blocks notifications, your phone needs openplate on the home screen first, or you simply have not turned them on, you now see what the morning message would say. The promise that at most two arrive a day is now the page's closing line in every state, instead of appearing only once notifications were on. ([7b49fdf](https://github.com/LowCarbCheck/openplate/commit/7b49fdf))

## [0.38.0] - 2026-09-21

### Added

- **openplate now carries a cancellation page and a withdrawal page that need no login.** German law obliges a seller to accept a cancellation under § 312k BGB and a withdrawal under § 356a BGB through a function on the site itself, so `/kuendigung` and `/widerrufen` are now two public pages, each with its own confirmation step, and both are linked in the footer of every page. A page asks for an email address and nothing else. It carries no retention offer, no pause, no discount, no survey and no support link, because the statute allows none of them. The openplate server writes the declaration down before anything else and sends a confirmation by mail at once. The four button labels are the words the statute names, so they read in German in every language. The withdrawal instruction now names the function as well. This needs openplate-core 0.18.0 or newer, which is where the two pages post to. ([86a5bb9](https://github.com/LowCarbCheck/openplate/commit/86a5bb9)) ([2165150](https://github.com/LowCarbCheck/openplate/commit/2165150)) ([ff76a8c](https://github.com/LowCarbCheck/openplate/commit/ff76a8c))

### Changed

- **Cards on Insights, the dashboard and Fasting now read in a clear order.** Every card title is the same size, 18 px, where half of them were 16 px and half 18 px over the same body text, so a title now stands clear of the line under it. The small labels above a figure, such as "Latest" and "To target" on the weight card, are grey capitals, so they no longer look like the sentences around them. The weight card and the summary of your last 7 days draw a tile only for a figure, and the reason a figure is missing is one line under the row instead of a sentence inside a tile. The three filter groups on the Nutrition tab, Metric, Time span and Meal, are named above their buttons. ([4ed94e7](https://github.com/LowCarbCheck/openplate/commit/4ed94e7))
- **The name openplate is now set thin, with the first half in teal, and centred on the mark.** The word beside the mark in the sidebar, the phone menu, the public header and the first screen used to be set in a heavy serif. It is now set in the same monospace face as the rest of the app, at its thinnest weight, with "open" in the brand teal and "plate" in the page ink, and lifted so the middle of its letters sits on the middle of the mark. The big name on the front page and the small name above the page title on a phone follow the same recipe. The serif font file is gone, so the app downloads 67 KB less. ([41433f3](https://github.com/LowCarbCheck/openplate/commit/41433f3))

## [0.37.0] - 2026-09-21

### Changed

- **openplate takes on the look of lowcarbcheck.org.** The app is set in the same monospace face as lowcarbcheck.org, on every screen but the long ones: the privacy policy, the terms and the other legal pages keep the old face, because a monospace paragraph in a phone column runs to about 35 characters a line. The panel at the top of Diary, Overview and Insights is a plain card carrying faint graph paper now, instead of a teal wash, and the same paper sits behind the landing page. Cards are flat with a thin edge, and a corner tells you what a thing is: a small corner for a row of figures, a card corner for a card, a wide one for the single panel at the top of a screen. The small uppercase labels above a group are grey, and so are the chips that state a number, which leaves the teal for the tab you are on, the one main button and the links. The word openplate keeps its own face and nothing else uses it. Settings rows kept their icon and lost its tinted tile. Nothing moved, nothing was removed, and no setting changed. ([badd1f2](https://github.com/LowCarbCheck/openplate/commit/badd1f2)) ([b751650](https://github.com/LowCarbCheck/openplate/commit/b751650)) ([1f2a259](https://github.com/LowCarbCheck/openplate/commit/1f2a259))

### Fixed

- **The backup reminder is quiet when a server holds your diary.** The amber reminder on your diary says your diary lives on this device only, and it said so whether or not a copy existed anywhere else. It appeared on a hosted instance, where your account always keeps an encrypted copy, and it appeared on a self-hosted one after you signed this device in to sync. Only an export ever cleared it, so signing in never did. It now stays quiet whenever a server holds a copy, including the moment after a reload while the app is still reopening your session, so it is never shown and then taken away. On a device with no account and no sync, nothing changed. ([9987153](https://github.com/LowCarbCheck/openplate/commit/9987153))
- **The update notice wraps instead of cutting off the version.** The row that appears above the header when a newer openplate exists was one line that trimmed itself to fit, so on a phone it read "openplate 0.35.1 is ava..." and hid the very thing it was telling you. It now takes a second line when the sentence and the buttons do not fit side by side, in all six languages. Reload and the dismiss key are 44 px tall, up from 28 px and a bare line of text, and they stay together so the dismiss key never ends up alone on a line. ([e52ea21](https://github.com/LowCarbCheck/openplate/commit/e52ea21))

## [0.36.0] - 2026-09-20

### Added

- **The app now shows you what changed after an update.** The first time you open openplate on a newer version, a card on your diary and your home screen lists the main changes and links to a new What's new page under About. That page keeps the notes of the last three releases, in your language. The card stays until you dismiss it or open the notes, on each device, and only for people who used openplate before the update: a device that is new to openplate is never told what changed. The notes travel inside the app, so nothing is fetched and the page works offline. ([657ac9f](https://github.com/LowCarbCheck/openplate/commit/657ac9f))

### Changed

- **Your fasts now follow you to your other devices.** A fast used to live on the one device it was started on, so erasing that device, losing it, or opening openplate on a tablet left the fasting history behind. Starting a fast, ending it, writing a mood or a note, and removing a fast all reach your account now and land on your other devices. If two devices both started a fast while they were offline, you will see two open fasts on both of them: the newest is the one that counts as running, and the other sits in your history marked still open, with a Remove button. Nothing is ever closed at a time you did not choose. Update every device you use: one still on an older version does not pass on a deleted fast, so a fast you removed can come back. ([822d2bf](https://github.com/LowCarbCheck/openplate/commit/822d2bf))
- **Your pantry now follows you too.** What is in the fridge used to stay on the device that photographed the shelf, so the list you wrote on a tablet was not there when you stood in the shop with your phone. A photographed shelf, a corrected line and a removed row all reach your other devices now. Two devices that each photographed a fridge show one combined list you can edit down, the same way a second photograph on one device already works. The photograph itself is still never stored and never sent anywhere but your own AI provider. Update every device you use: one still on an older version does not pass on a removed pantry row, so a row you took off the list can come back. ([822d2bf](https://github.com/LowCarbCheck/openplate/commit/822d2bf))
- **The sign-out dialog now notices a saved meal you renamed.** It compared your saved meals by name and count only, so renaming one and signing out before the next sync read as nothing waiting, above the box that erases your diary. It compares the contents now, so an edit you have not sent yet is named. A device that has not synced since this change warns about its saved meals once, then settles. ([10da2df](https://github.com/LowCarbCheck/openplate/commit/10da2df))
- **The sign-out dialog counts your fasts and your pantry, and warns only about what it cannot check.** It used to end with one sentence naming fasts, saved meals, the pantry and your keys together, on every sign-out, whether or not anything was actually waiting. Fasts and pantry rows are counted with the rest of your diary now. Saved meals get a sentence only when this device is holding meals your account has not been told about. Your sharing and research keys get a sentence of their own, because they are sealed and this check cannot open them. ([822d2bf](https://github.com/LowCarbCheck/openplate/commit/822d2bf))
- **The About screen now says when the server is behind, and who can update it.** When a newer release exists, the Updates card opens with a plain line naming the version the server runs and the newest one. Below it, one sentence fits the reader. On a self-hosted instance it says to pull the new image and restart the server, and that the app has no update button. On a hosted instance it says only the person who runs the server can update it, so there is nothing for you to do. A server on the newest release says Up to date. With update checks turned off, the card is unchanged. ([edd9ab0](https://github.com/LowCarbCheck/openplate/commit/edd9ab0))

### Fixed

- **An end you recorded is never undone by another device.** If you ended a fast on your phone and then adjusted that same fast's start time on a device that had not synced yet, the two changes could tie, and which one won came down to which device happened to sort first. Half the time the fast reopened and the end you recorded was gone. The end now always survives, together with the mood and note you wrote with it, while the other device's start-time change is kept as well. Nothing is ever ended for you. ([540bcec](https://github.com/LowCarbCheck/openplate/commit/540bcec))
- **The fast alert now follows the fast, on every device.** The one-off notification for a fast reaching its target was set by the screen you started the fast on. Now that fasts travel, a fast started on your phone left your tablet silent, and worse, a fast you ended on one device left the other one set to buzz for a fast that was already over. Every device now works out what is running after each sync and when the app starts, and switches the notification off when nothing is. ([c45ec5d](https://github.com/LowCarbCheck/openplate/commit/c45ec5d))
- **The privacy policy and terms now name your sharing and research keys too.** The lists of what lives on your device and what your account holds an encrypted copy of were completed for fasts, the pantry and the rest, and still left out the keys behind clinician sharing and study contributions. Those travel in a sealed part of the same encrypted copy, and both documents now say so. A test fails from now on if a new kind of thing starts syncing before somebody decides what to call it in the policy. ([eff28cf](https://github.com/LowCarbCheck/openplate/commit/eff28cf))
- **The sign-out dialog says what to do about your keys, not just what it cannot check.** The line about sharing and research keys warned you that an erase may lose them and stopped there. It now tells you a backup file includes them, so there is something to do before you confirm. ([eff28cf](https://github.com/LowCarbCheck/openplate/commit/eff28cf))
- **Adding a food by hand now says what is missing in your language.** Leaving the Name field empty answered with the words the form validator uses among themselves, in English, whatever language you read the app in. It now asks for a name in your language, and a name made only of spaces is refused too instead of saving a food with a blank name. ([edb5abb](https://github.com/LowCarbCheck/openplate/commit/edb5abb))
- **The controls on the add form and on Your foods are thumb sized.** The meal picker beside the grams field was two thirds the height of the field next to it, and the Add entry button under it was the same size. Edit and Remove on Your foods were 32 px squares four pixels apart, with Remove deleting a food for good. All of them are at least 44 px on a phone now, with room between the two keys, and unchanged on a desktop. ([edb5abb](https://github.com/LowCarbCheck/openplate/commit/edb5abb))
- **Overview's week card and its two tiles fit a phone.** The sentence offering the Insights tour was squeezed into a column about 80 px wide beside its two buttons and ran to five lines; it now has the width of the card, with the buttons under it. The last-7-days tile and the weight tile drew side by side at every width, which left the week chart 122 px for a seven-column weekday row: the names ran past the card edge in English and in Turkish, in 10 px type. The two tiles take the full width on a phone and sit side by side again from a tablet, the weekday names are readable, and the two tiles draw the same height when they share a row. ([3ae54cc](https://github.com/LowCarbCheck/openplate/commit/3ae54cc))
- **A saved meal shows the whole name you gave it.** The name was cut off mid-word on one line, so "Porridge with blueberries" read as "Porridge with blue...". It wraps to a second line now. Log now and Remove beside it are thumb sized on a phone, with room between them. ([8a60a9a](https://github.com/LowCarbCheck/openplate/commit/8a60a9a))
- **The describe screen names itself once, and the first-run headings keep their last word company.** A screen reader met two identical page titles on the describe screen and had no single name for it. The Yesterday in numbers heading on your daily catch-up sat flush on the first row it labels. Headings on the landing page, in the first-run questions and on the recovery screen used to break with one word alone on the last line; they balance their lines now. The links on those screens, and the Send key on the describe screen, are thumb sized on a phone. ([9550e4a](https://github.com/LowCarbCheck/openplate/commit/9550e4a))
- **The privacy policy and terms now list everything that syncs.** Both documents listed your foods, food logs, weight entries and goals, and stopped there. Your fasts, your fasting routine, your saved meals, your pantry and your streaks and awards are in the same encrypted copy and were never named. All four lists now say so, in the same sentences, with nothing else changed. The pages carry today's date. ([f1f85df](https://github.com/LowCarbCheck/openplate/commit/f1f85df))
- **Buttons, switches and the date picker are thumb sized on a phone.** Buttons, icon buttons, the drawer close button, the switches and the date picker cells were 28 to 36 px tall, under the 44 px a thumb needs. They are 44 px on a phone now, a switch that is off is easier to see, and a two line card title no longer runs its lines together. Desktop sizes did not change. ([8bcb52f](https://github.com/LowCarbCheck/openplate/commit/8bcb52f))
- **The diary no longer scrolls sideways, and the next day arrow stays on screen.** A long quick add food made the page wider than a phone, and on a 360 px phone the arrow to the next day sat past the edge. Both fit now, in German and Turkish too. The meter bars are one length on every row, the header message no longer leaves one word alone on a line, and an entry no longer breaks a fact across two lines. A group whose entries have no carb figure says so instead of showing 0 g. ([8bcb52f](https://github.com/LowCarbCheck/openplate/commit/8bcb52f))
- **The fasting history, the Insights charts and their filters fit a phone.** In Turkish the fasting history ran past its card and start dates were cut off. Chart labels were drawn at 4 to 5 px and tab names were cut. They wrap and resize now, filter chips are 44 px tall, and the 3 months choice is translated in every language. ([8bcb52f](https://github.com/LowCarbCheck/openplate/commit/8bcb52f))
- **Settings pages have thumb sized controls and even spacing.** Labels sit clear above their fields, and weigh in delete buttons, toggles and links reach 44 px. The model choice on the AI page uses the app's own style instead of the browser's. ([8bcb52f](https://github.com/LowCarbCheck/openplate/commit/8bcb52f))
- **German legal headings fit a phone.** Long words such as Nutzungsbedingungen ran past the right edge and lost their last letters. Headings now wrap, and the opening paragraph of each legal page is smaller on a phone. ([8bcb52f](https://github.com/LowCarbCheck/openplate/commit/8bcb52f))
- **The app's own frame is thumb sized, and the bottom bar steps aside for the keyboard.** The menu mark in the top corner, the Back link on every settings page, and the six links in the footer of the public pages were 20 to 36 px tall, under the 44 px a thumb needs. All of them are 44 px on a phone now, drawn exactly as before, and unchanged on a desktop. On a short screen, a keyboard left the header and the bottom bar covering more than a quarter of what was visible, with the bar over the field you were typing into. The bar now steps aside while a field has your attention and comes back when you leave it, without moving the page under you. ([af67d61](https://github.com/LowCarbCheck/openplate/commit/af67d61))
- **The diary's day bar sits against the header, and the lists match the rest of the app.** A strip of page background showed between the header and the date bar at the top of the diary. Search results on Add food and the rows on Your foods drew tighter corners and less padding than every other list. The box that asks whether to delete something was the only sharp cornered panel in the app. They all draw the same shape now. On the About screen, the licence and source links are a whole row to tap. On a narrow phone in Turkish, a row no longer puts its value on top of its label. ([af67d61](https://github.com/LowCarbCheck/openplate/commit/af67d61))

### Docs

- **The sync guide says what travels between your devices and what never does.** A new section lists what a sync carries, names your saved meals as the one part that still travels as a whole list, and states the three things that stay put: plate photos, your AI provider key, and the record of what you deleted. ([822d2bf](https://github.com/LowCarbCheck/openplate/commit/822d2bf))

## [0.35.1] - 2026-09-20

### Docs

- **The topologies and sync documents no longer say the server cannot read entries.** The topologies guide said the sync service cannot read a single entry, and the sync guide described the diary as ciphertext the service cannot read. The service keeps each account's recovery code, sealed under a secret of its own, so the operator of an instance can in principle open a diary. Both documents now say so. A new test fails if either claim comes back. ([72cc810](https://github.com/LowCarbCheck/openplate/commit/72cc810))

## [0.35.0] - 2026-09-20

### Added

- **Insights can now show the last 90 days.** A new 3 months choice sits beside Week, 2 weeks and Month. At Month and 3 months, the chart draws one bar per week, showing the average of the days you logged that week, so the bars still fit a phone. A week you logged nothing stays empty rather than showing zero. Insights now reads only the days it shows, so a long diary no longer slows the screen down. ([416001a](https://github.com/LowCarbCheck/openplate/commit/416001a))

- **Progress is renamed to Insights, and now opens on four tabs.** The menu item and the page title say Insights, and the page still lives at the same address. Overview shows your streak, this week's recap and your weight. Nutrition shows the carbs and calories chart, with a link to Nutrients. Meals filters that same chart to one meal. Goals shows your 13-week goal grid. Switching tabs keeps the time span and the meal filter you had chosen. ([3975809](https://github.com/LowCarbCheck/openplate/commit/3975809))

- **The Nutrition tab charts protein, fat and fiber too.** Every metric marks a day with missing macros the same way, as a minimum. Protein draws your protein goal as a floor and names a day below it, without a warning colour. Net carbs show your total carbs as an outline behind each bar, so fiber and sugar alcohols are the gap. Daily bars get a 7-day average line. At Month and 3 months, the chart title says each bar is a week's daily average. A new card shows where your calories come from, split into carbs, protein and fat. The chosen metric is now part of the address. ([90030ed](https://github.com/LowCarbCheck/openplate/commit/90030ed))

- **The Meals tab now shows your averages and your usual foods.** With no meal chosen, it shows your average log for each meal and how many days that covers. It shows how your calories or net carbs split across breakfast, lunch, dinner and snacks each day, adds a line for anything logged with no meal chosen at all, and tracks how much of your week's calories came from snacks over time. Choosing one meal keeps the existing chart and adds that meal's average and your five most-logged foods there. Nothing here shows a goal or says a meal was missed. ([aa26b36](https://github.com/LowCarbCheck/openplate/commit/aa26b36))

- **The Goals tab now shows how often you met each goal.** Each goal you set gets a card over the last 13 weeks. It shows on how many finished days you met it, how far under or over it you were on average, and, unless streaks and awards are hidden, your current and longest run of met days. A day without enough detail to check a goal is left out and counted apart, never counted as missed. A card for fasting shows how many finished fasts reached their own target. Everything is measured against your current goals. With no goal set, the tab invites you to set one instead. ([a016c9a](https://github.com/LowCarbCheck/openplate/commit/a016c9a))

- **Overview now opens with a summary of your chosen time span.** It shows how many days you logged, your average calories, net carbs and protein, and how each compares with the same span before it. Three cards follow, jumping straight to Nutrition, Meals and Goals. Your last 7 days on the home screen, your goal grid there, and today's summary in the diary now link straight into the matching tab. A one-time card on the home screen points at Insights once you have logged a few days, and stays gone once you dismiss it. ([e771527](https://github.com/LowCarbCheck/openplate/commit/e771527))

- **The data screen says what is inside the JSON download.** The download holds the private key used when someone shares their diary with you, and the seed for your research pseudonym. A note beside the download buttons now states this. It is present in all six languages. ([66f03d3](https://github.com/LowCarbCheck/openplate/commit/66f03d3))

### Changed

- **The app no longer mentions openplate-gateway.** That service merged into openplate-core and was archived, so no server can send the refusal the app still had an error screen for. The error text, translations in five languages, the analytics reason, and a retired table in the local database are gone. The refusals a managed instance sends are unchanged. ([0a4a18c](https://github.com/LowCarbCheck/openplate/commit/0a4a18c))

### Fixed

- **A saved meal now reaches the server by itself.** The check that decides whether this device has anything to send previously ignored saved meals. Creating, renaming, or deleting one registered nothing the device could see. The meal uploaded later, carried along by an unrelated change to a food log. A device erased before that happened lost the meal. A saved meal now counts as a change on its own. Fasts and the pantry still do not, and both omissions are deliberate. A fast is never synced, and the pantry is a working list of what is in one device's kitchen. ([460bce9](https://github.com/LowCarbCheck/openplate/commit/460bce9))

- **Signing out no longer says everything reached the server when it has not.** The sign-out dialog counted a queue that nothing has written to since the diary moved onto the device. So it always said "Everything on this device has reached the server." above the box that erases the diary. It now counts the changes the sync has not sent yet and any estimate reports still waiting. It says so when it could not check. It also names what the check does not cover: fasts, saved meals, the pantry, and your sharing and research keys. Rows left in that retired queue are deleted, because nothing could ever send them. ([9f93ff0](https://github.com/LowCarbCheck/openplate/commit/9f93ff0))

- **The app no longer says the server cannot read your diary.** The sync server keeps each account's recovery key, sealed, so that a password reset gives the diary back, and so the operator of an instance can technically open it. The data settings, the offline page, the recovery screen, the landing page, and the sharing screen still said the server could not read the copy it holds. So did the estimate report consent and the terms of service. They now say what is true. The terms described a forgotten passphrase as a permanent loss, and now describe the reset by email. The privacy policy already named the recovery key; its backup paragraph now also lists the recovery keys and estimate reports. The legal pages carry today's date. The consent step before you send a report about a wrong estimate was one of those strings, so its wording version moves with it, and a stored report still names the words the person read. ([1bccf3f](https://github.com/LowCarbCheck/openplate/commit/1bccf3f))

### Docs

- **The architecture docs describe what each server holds today.** They cover the one optional secret the app server can hold, and the food names it forwards to LowCarbCheck. They also cover the recovery key the sync server keeps, and the optional features of openplate-core. openplate-gateway is listed as archived. ([544dc77](https://github.com/LowCarbCheck/openplate/commit/544dc77))

- **The self-hosting and sync documents name the key material in a backup.** They previously described the download only as your diary. It also holds your sharing private key and your research pseudonym seed, so a copy of that file requires the same protection as the diary itself. The menu path in both documents is corrected. ([66f03d3](https://github.com/LowCarbCheck/openplate/commit/66f03d3))

## [0.34.1] - 2026-09-19

### Changed

- **The server now runs as one process in the container.** The image previously started the server through `pnpm exec tsx`. That kept pnpm and the tsx command line running as idle parent processes, using about 70 MB per instance. It now starts `node --import tsx ./server.ts` directly. You do not need to change anything. The entry point is still `scripts/start.sh`, and stopping the container still lets open connections finish. ([0a9271b](https://github.com/LowCarbCheck/openplate/commit/0a9271b))

## [0.34.0] - 2026-09-19

### Added

- **The streak on the home screen and on Progress is now the number of days you used the app.** You see one number in both places, and it counts any day you used openplate. A day over your carb goal no longer sets it to zero. Staying at or under your carb goal is now a separate badge, earned at a week, a fortnight, a month and a hundred days. When a streak changes, the app makes no announcement, and the count simply reads lower the next time you look. ([bf92980](https://github.com/LowCarbCheck/openplate/commit/bf92980))

- **A new screen lists what you have done with the app.** The streak card on Progress opens Your record, showing the functions you have tried, the days in a row you used the app, and the days in a row you stayed under your carb goal. The screen contains no scores, no levels and no comparisons with other people. When you earn a badge, a single line names it, once. You can use a switch in Preferences to hide the streak and the entire record screen, while the app continues keeping track in the background so turning it back on shows your full history. ([bf92980](https://github.com/LowCarbCheck/openplate/commit/bf92980))

- **Your past counts: the app rebuilds the record from the diary you already have.** When you first start this version, openplate checks your food logs, weigh-ins and fasts, then marks every day that shows you used the app. If you tracked for two years, your record shows two years instead of one day. Badges earned in the past are dated to the day you earned them and arrive already marked as seen, so nothing is announced for previous months. Repeating a meal, editing the pantry and exporting a backup leave no trace in a diary, so you earn those three badges the next time you complete the action. ([24e073e](https://github.com/LowCarbCheck/openplate/commit/24e073e))

- **What counts as using the app, and what the record survives.** Logging food, confirming a scan, running a fast, weighing in, repeating a meal, editing the pantry and exporting a backup each count for the day you did them. Receiving a sync from another device does not count, so a day you never opened the app is never marked as active. If you use a phone and a tablet on the same day, both are kept, and a device that loses its stored data cannot erase the record from your other devices. A day you used the app stays counted, and an earned badge is never removed. ([af4eb45](https://github.com/LowCarbCheck/openplate/commit/af4eb45))

- **Your backup file moves to version 23.** Your record travels inside your backup and inside the encrypted sync. Backups written by an older version still import, and a badge from a newer version is kept rather than dropped. A backup written by this version cannot be read by an older version of openplate. ([8029888](https://github.com/LowCarbCheck/openplate/commit/8029888))

- **The instance can hold a food database key, and says so when the database refuses.** A new `FOOD_DB_API_KEY` setting lets whoever runs the instance authenticate the food lookups openplate already makes. Leaving it unset keeps the free anonymous tier, which is what every instance used until now. If the food database refuses the instance, because the key is wrong or the allowance is spent, the scan review shows one quiet line saying the numbers are estimates, and the server log carries a warning instead of nothing. A scan still completes, still shows numbers and can still be logged. ([59e9fe1](https://github.com/LowCarbCheck/openplate/commit/59e9fe1))

## [0.33.0] - 2026-09-18

### Changed

- **Micronutrient reference values now come from the German DGE.** The Nutrients screen previously displayed EU EFSA targets published by LowCarbCheck. It now displays DGE figures. Several targets change: vitamin D moves from 15 to 20 micrograms a day, potassium from 3500 to 4000 milligrams, and iron for women after menopause from 16 to 14 milligrams. Your age band and sex still decide which figure you see. Beta-carotene has no DGE figure, so the screen shows none rather than borrowing one. An administrator can switch the instance back to EFSA or to US NASEM figures. The footnote under each nutrient names the source document for that figure. ([cd96c4e](https://github.com/LowCarbCheck/openplate/commit/cd96c4e))

### Added

- **The imprint and the withdrawal instruction carry a telephone number.** German law has required a telephone number inside the Widerrufsbelehrung since 2022, and the field was empty. It now renders on both pages, in every language. ([5bac555](https://github.com/LowCarbCheck/openplate/commit/5bac555))

- **An administrator chooses whose reference values the instance shows.** A new Settings tab in the administration console picks between the German DGE, the EU's EFSA and the US NASEM figures, and every device on the instance follows it on the Nutrients screen, in every language. The footnote under each nutrient still names the document the number came from, so the change is visible where the number is. A device that already has the app open keeps showing the old values until the page is reloaded, and the form says so. An instance running no openplate-core, or one older than this setting, is unaffected and keeps whatever its own server was configured with. ([d8d53a7](https://github.com/LowCarbCheck/openplate/commit/d8d53a7))

## [0.32.0] - 2026-09-17

### Added

- **The app keeps a pantry, and cooks the rest of your day out of it.** Photograph a shelf or a fridge, or write what you have, and openplate turns it into a list of ingredients on the new Pantry screen, which you can correct line by line. The list stays on your device. From it, Suggest a meal proposes two or three recipes for the next meal, sized to the calories, protein, carbs and fat still open in your day, so a protein-heavy breakfast is not followed by a protein-heavy lunch. Each recipe shows what one serving costs against what is left and about what it weighs, you say how many servings you ate, and one tap writes them into the meal at that weight. ([1326c77](https://github.com/LowCarbCheck/openplate/commit/1326c77)) ([7b609ac](https://github.com/LowCarbCheck/openplate/commit/7b609ac)) ([a21545f](https://github.com/LowCarbCheck/openplate/commit/a21545f)) ([69b3d7f](https://github.com/LowCarbCheck/openplate/commit/69b3d7f)) ([d7b0605](https://github.com/LowCarbCheck/openplate/commit/d7b0605)) ([745574e](https://github.com/LowCarbCheck/openplate/commit/745574e))

### Fixed

- **A second photograph of your shelf no longer empties the pantry.** Confirming a reading only ever kept the lines that reading named, so photographing the fridge on Monday and the cupboard on Tuesday left you with the cupboard alone, and nothing said the rest had gone. A photograph or a written list now adds to the pantry, and removing a line in the list is still the way to take something off it. Two smaller repairs went with it: a list that fails to save says so and stays on screen instead of looking saved, and an amount typed as 1,5 is read as one and a half rather than as one. ([196b907](https://github.com/LowCarbCheck/openplate/commit/196b907))

## [0.31.0] - 2026-09-14

### Added

- **Generated Podman Quadlet units ship for every openplate deployment shape.** The directory `docker/quadlet/<scenario>/` holds the `.container`, `.volume`, and `.network` files that Podman needs to run openplate as a systemd service. These units are generated directly from existing compose files instead of written by hand. A push gate check regenerates and verifies them, so a stale unit never reaches you. ([6dea296](https://github.com/LowCarbCheck/openplate/commit/6dea296))
- **openplate now speaks French, Italian, Spanish and Turkish too.** The whole app, the legal pages included, is available in six languages. A language strip sits in the device menu at the top right, right under the theme choice, so you can switch without opening Settings; Settings keeps its own list. Picking a language reloads the page in it, exactly as before. ([b725b06](https://github.com/LowCarbCheck/openplate/commit/b725b06))

### Changed

- **The diary adds food through the same one-line composer as the home screen.** The three separate photo, type and speak buttons are now a single field: the wide part opens the composer for writing, and a microphone and a camera sit inside the same frame to the right of it. All four places the diary offered them use it, the three empty days and the bar under a day that already has entries. Every one still carries the day you are looking at, so a back-dated photo or sentence lands on that day, not on today. The copy-from-yesterday chips are unchanged. ([22746f6](https://github.com/LowCarbCheck/openplate/commit/22746f6))
- **The compose files name the Postgres image with its registry.** `postgres:17-alpine` is now `docker.io/library/postgres:17-alpine` in `compose.sync.yml` and `compose.full.yml`, because rootless Podman refuses to guess a registry for a short name without a terminal. The same files stop forwarding `SIGNUP_MODE`, which openplate-core rejects at boot, and declare the sync service's `/health` check, which Podman otherwise drops on pull. The generated Quadlet units gain `TimeoutStartSec=300` beside `Notify=healthy` and each service name as a network alias; both came out of starting every scenario rootless on a Fedora host, recorded in each `docker/quadlet/<scenario>/README.md`. ([50ed073](https://github.com/LowCarbCheck/openplate/commit/50ed073))
- **The add sheet in the bottom bar shows the same composer as the rest of the app.** Its three rows are gone. In their place is the one-line field you already use on the home screen and in the diary: write on the wide part, dictate with the microphone, photograph with the camera. The sheet still carries the day you are looking at, and its camera is the same one the raised button opens, so a photo taken from the sheet still reaches the camera on iPhone. ([22746f6](https://github.com/LowCarbCheck/openplate/commit/22746f6))
- **The camera in the add sheet is drawn as an outline, not a filled key.** The raised round button in the bottom bar sits a few pixels below that sheet and is already a filled camera, so two filled cameras were competing for the same tap. Only the sheet changes. On the home screen and in the diary the camera keeps its filled look, because there it is the one camera on the page, and on a desktop or a tablet there is no round button at all. ([5798d29](https://github.com/LowCarbCheck/openplate/commit/5798d29))
- **The home screen's Like yesterday button is now a preview card.** It shows the day it repeats, with dashed rows sketching the entries it would copy and a caption underneath for the count. Tapping the card still copies the same whole day as before. The pill button on the write screen is unchanged. ([423dde9](https://github.com/LowCarbCheck/openplate/commit/423dde9))

### Fixed

- **The add button in the bottom bar logs to the day you are looking at.** Its camera, its Type row and its Speak row always went to today, even while you were reading an earlier day in the diary, so a photo or a typed meal quietly landed on the wrong date and nothing said so. All three now carry the day on screen. ([4a3b065](https://github.com/LowCarbCheck/openplate/commit/4a3b065))

## [0.30.0] - 2026-09-14

### Added

- **The progress chart can now show a single meal over time.** A new filter sits beside the net carbs and calories toggle on the progress screen. You can pick all meals, breakfast, lunch, dinner, or snacks. When you select one meal, the chart bars display only the food logged to that slot across the days. The daily goal line disappears in this view, since goals apply to the whole day. The page URL saves your filter choice, so it stays active when you refresh. ([cbf1966](https://github.com/LowCarbCheck/openplate/commit/cbf1966))
- **The app now suggests frequent foods based on the time of day.** You will see your regular items under the add search box and below the scan camera. The list uses your past diary entries. Foods you log most often at that hour appear first, along with saved meals you usually eat then. One tap adds the item to your log, and the undo button clears it in one step. If you do not have logged habits for that specific hour, the row stays empty. ([a3e4faa](https://github.com/LowCarbCheck/openplate/commit/a3e4faa))
- **The diary now offers to save meals you log three days in a row.** When a meal group has the same foods and portions as the two days before it, a line under the header asks to save it. Saving uses the existing header button, and the meal goes into your saved meals. You can dismiss the prompt per meal. It stays dismissed on that device. ([a4c5159](https://github.com/LowCarbCheck/openplate/commit/a4c5159))

### Fixed

- **The photo review card now shows the right net carbs for a food read from a nutrition label.** European labels already leave out fibre from total carbohydrates. The review step previously subtracted fibre a second time, which could show 0 g net carbs while the saved entry was correct. The review card now handles these labels the same way the saved entry does, so the two figures match. ([bad5acd](https://github.com/LowCarbCheck/openplate/commit/bad5acd))
- **The notification badge is now the openplate glyph instead of a white circle.** Android generates status bar icons from the app icon silhouette. Because the main icon is a solid disc, the badge appeared as a plain dot. The notification now uses a cut-out version of the mark. ([39e92b0](https://github.com/LowCarbCheck/openplate/commit/39e92b0))
- **The review step no longer flags an error when fibre exceeds carbohydrates on European nutrition labels.** European labels list carbohydrates with fibre already subtracted. Foods high in fibre often show a higher fibre count than carbohydrate count. The review step used to treat this as an impossible calculation and asked you to verify the entry. It now applies the regional label convention used for net carbs. Standard European labels will not trigger a false warning, but impossible numbers still will. ([cee1409](https://github.com/LowCarbCheck/openplate/commit/cee1409))

## [0.29.7] - 2026-09-13

### Changed

- **Every settings page now uses the same grouped layout as the settings list.** Each section on a settings page is a labelled inset panel, like the rows on the settings screen, instead of a desktop-style card with its own large heading. Nothing behind the sections changed: the same fields, switches and links, in the same order. ([20b5936](https://github.com/LowCarbCheck/openplate/commit/20b5936))

## [0.29.6] - 2026-09-13

### Changed

- **The settings page now reads as one grouped list, not a stack of cards.** Each section under Settings is a single inset list with a hairline between rows, matching how phone settings screens are usually laid out, instead of every row sitting in its own bordered box. ([152cfd1](https://github.com/LowCarbCheck/openplate/commit/152cfd1))

### Fixed

- **Turning notifications on now reports what actually happened.** A permission question you closed without answering was reported as blocked and took the switch off the page, so there was no way to ask again; it now says the question went unanswered and leaves the switch there, and if a second tap goes unanswered too, because some browsers quietly stop asking, it points you at your browser's site settings instead. A session that ended on this device reads as signed out rather than as an instance that sends nothing, and a subscription left over from another notification key is dropped instead of registered to an address the instance can never reach. The page re-reads the browser permission when you come back to it, so allowing notifications in your browser settings takes effect without a reload. ([a4d7990](https://github.com/LowCarbCheck/openplate/commit/a4d7990))
- **A long status message no longer pushes the page wider than the screen.** An error banner in the header, such as a blocked-notifications warning, could stretch past the edge of a phone screen instead of wrapping. It now wraps to up to three lines at a smaller size, and the header keeps its fixed height. ([2110bb8](https://github.com/LowCarbCheck/openplate/commit/2110bb8))

## [0.29.5] - 2026-09-13

### Fixed

- **Losing local data no longer removes your account sharing keys.** Your sharing key pair, in-person verified clinicians, and joined studies travel in a sealed part of your sync data. The app previously sent whatever it found. If a browser wiped local data while the app ran, the app found nothing, sent an empty copy, and replaced your account data. No error showed, because this section does not store deletion records. The app now records removals as you make them, just as it does for diary entries and fasts. It sends a reduced set only if every missing item was removed on purpose. Otherwise, it returns your account copy unchanged, restores the items to the device, and marks that no local changes were published. Unpinning a clinician or leaving a study still syncs to your account on the next run. ([90728fb](https://github.com/LowCarbCheck/openplate/commit/90728fb))
- **Deleting an entry during an active sync now stays deleted.** Removing an entry while a sync ran previously allowed that sync to restore the entry, with no notice on screen. The sync now checks the local deletion record right before writing, and the deletion syncs to your account on the next run. ([ef8d1b9](https://github.com/LowCarbCheck/openplate/commit/ef8d1b9))
- **Pending delete records no longer stay in storage forever.** Four types of entries were logged in that record and never cleared, including items created and deleted between syncs. Every entry processed by a sync is now removed once the sync matches with the account. An entry whose deletion the account did not accept in that sync is kept for the next one. ([0b542ee](https://github.com/LowCarbCheck/openplate/commit/0b542ee))
- **Data restore notices now appear only for the matching account.** The notice explaining that your device lost local data and your account restored it stays visible after the sync finishes. Switching accounts on that device previously showed the new user that notice, along with the previous user's entry count. The notice now tracks its specific account, and the app clears it when another user signs in. ([1b360a0](https://github.com/LowCarbCheck/openplate/commit/1b360a0))
- **Restored entry counts now match the actual rows written back.** Two cases were counted incorrectly. When account fasts or saved meals replaced local lists, the app reported zero restored items, because neither list stores deletion records. A sync that held back sealed data also counted as a restored entry, even though nothing was written to the device. The count now reflects only diary rows written to storage, and held sealed data is noted in the log only. ([1b360a0](https://github.com/LowCarbCheck/openplate/commit/1b360a0))

## [0.29.4] - 2026-09-12

### Fixed

- **The app now records deleted fasts and saved meals before syncing.** These two lists do not merge across devices yet. Whichever device syncs next sends its whole list. Until now, that happened whenever a device thought its local storage looked fine. A device that lost its data looked fine, because the app created an empty store before reading it, letting an emptied list overwrite your account copy. The app now writes down each fast and saved meal you delete at the moment you remove it, matching how diary entries work. It only uploads a shorter list if every missing item was removed on purpose. If items are missing without a deletion record, your account keeps its list and sends it back to the device. Clearing a long list still works, because each removal is recorded as you go, showing your account that the reduction was intentional. A device whose record predates this change syncs once to your account, then returns to normal on the next sync. ([129fa9f](https://github.com/LowCarbCheck/openplate/commit/129fa9f))

## [0.29.3] - 2026-09-12

### Fixed

- **Your app now writes a deletion down instead of guessing at one.** Yesterday's fix compared what is stored against what was loaded, and that comparison cannot see the difference between a diary somebody emptied and one a browser threw away: both read as zero. On the order the app really starts in, it also creates an empty store before it looks, so an emptied device looked perfectly healthy and its entries were still reported to your account as deleted. From now on the app records each entry you delete, at the moment you delete it, alongside the entry itself. Only a deletion it has written down is ever sent. Lose your local data and there is nothing written down, so nothing is deleted and your account puts the entries back. Delete eighty per cent of your diary on purpose and every one of those is written down, so all of them are sent. Three more things were put right with it: a device that had ever deleted one entry no longer waves through every later shrink of its data, a push your account turns back now applies what it just fetched instead of leaving the device empty and repeating itself, and the message you see when it happens no longer claims the app is out of date. The notice that says your entries were restored is now only shown when they actually were. ([e8ac79a](https://github.com/LowCarbCheck/openplate/commit/e8ac79a))

## [0.29.2] - 2026-09-12

### Fixed

- **A device that lost its local data no longer empties your fasts and saved meals.** Your fasts and your saved meals are not merged between devices yet, so whichever device syncs next hands over its whole list. If a browser had thrown that device's data away, or if the app had only half read it, the list it handed over was empty or short, and your account's copy was replaced by it. Neither one is a deletion anybody made, so neither is accepted any more: when a device cannot show what it holds, the copy already on your account is kept instead. A device that can show it holds none still means it, so a fast or a saved meal you really deleted stays deleted. ([794ba1a](https://github.com/LowCarbCheck/openplate/commit/794ba1a))

## [0.29.1] - 2026-09-12

### Fixed

- **A device that lost its local data no longer empties your diary.** A browser may throw away an app's local data when it needs the space. When that happened here, openplate compared what was left against its record of the last sync, concluded you had deleted every entry, and told your account to delete them too. A second device then pulled that result and emptied itself. This is how a real account lost its whole diary on 12 September. A deletion is now only ever sent when the device can show it happened, by checking what is stored against what it loaded; where the two disagree nothing is deleted, your account's copy is pulled back down, and the app says so on screen instead of showing a silent green tick. It also asks the browser again to keep your data, which is the setting that would have prevented it. ([02c86c8](https://github.com/LowCarbCheck/openplate/commit/02c86c8))
- **Coming back to the app no longer drops your sharing and research keys.** Every time a session resumed, openplate read your private key compartment before it had fetched it, got no answer, and reported those keys to your account as deleted. A device that already held them kept working, so nothing ever looked wrong, but a new device signing in received none of them and sharing quietly did not work there. "I have not read it yet" and "there is none" are now two different answers, and only the second one can delete anything. ([02c86c8](https://github.com/LowCarbCheck/openplate/commit/02c86c8))
- **A device whose data was cleared is no longer offered the setup wizard.** After a browser cleared the app's storage, openplate saw a device with nothing on it and started onboarding, and the answers given there outranked the real profile on your account. It now recognises a device that has synced before and offers to restore it instead. ([02c86c8](https://github.com/LowCarbCheck/openplate/commit/02c86c8))

## [0.29.0] - 2026-09-12

### Added

- **Your fast is visible on every page.** While a fast is scheduled or running, a small pill in the header on every page shows how long you have been fasting, with the current stage on wider screens, and opens the timer with one tap. On an installed app the home screen icon carries the whole hours as a badge where the device supports it. Overtime looks like any other minute, never amber. ([d798266](https://github.com/LowCarbCheck/openplate/commit/d798266))
- **The timer names the stage you are in.** Under the elapsed time the fasting page now says which stage your body is likely in (digesting, early fasting, low liver stores, rising ketones, ketosis, extended) and when the next one begins, and for the first hour of a new stage it says when you entered it. Every stage carries the same one line reminder that these are averages and not a measurement of you, and that on low carb you move through the early stages sooner. A collapsed "What happens when" list explains all six in one plain sentence each, with no claim the evidence does not support. ([d798266](https://github.com/LowCarbCheck/openplate/commit/d798266))
- **One usual fast, one tap to start.** Presets now run from 16:8 to 72 hours. A new Fasting page in settings holds your usual fast and an optional usual start time; the timer preselects that fast and offers "Start at 20:00" beside "Start now", and after a fast ends it offers to schedule the next one. The end button reads "Complete" once you reached your target and "End" before it, and ending lets you say how it went and keep a short note, both shown in your history. ([d798266](https://github.com/LowCarbCheck/openplate/commit/d798266))
- **Fasting figures that never grade you.** Above the history: fasts completed, your longest, your day streak (a day counts when you fasted at least an hour of it, so a 72 hour fast counts three days) and the hours you fasted this week. A streak of zero shows nothing at all. ([d798266](https://github.com/LowCarbCheck/openplate/commit/d798266))
- **A note of care before a long fast, and a calm notice while pregnant.** Starting a fast of 24 hours or more shows, once, who should not fast, what means stop and eat, and a reminder to drink water with a little salt; it never appears again unless you ask for it in settings. If your life phase says pregnant or breastfeeding, the fasting page shows a quiet notice that fasting is not advised and offers only the shorter presets. Nothing is ever blocked. ([d798266](https://github.com/LowCarbCheck/openplate/commit/d798266))

- **Today, everyone here: an opt-in pulse of what other people logged.** A new switch on the Sharing page, off by default, sends small rounded counts from your device: one meal with its calories rounded to 50 and protein to 5 g, one photo parsed, and a short "still fasting" signal while a fast runs. Never the food, the time, the photo or your goals. With it on, Overview shows a tile with today's meals logged, photos parsed, calories and protein tracked across everyone on your instance, and the fasting page says how many others are fasting right now. Both appear only once at least three people took part today; below that they show nothing rather than a lonely number. ([d4be8b1](https://github.com/LowCarbCheck/openplate/commit/d4be8b1))

- **Notifications, with a morning catch-up that states facts and stops.** A new Notifications page in settings turns on push notifications where the browser and the instance support them (on iPhone the app must be on the home screen first). Two kinds, both preselected once you turn the switch on and each with its own checkbox: a daily catch-up at a time you pick, 08:00 by default, and a word when a fast reaches its target. At most two a day. The catch-up is written on your device, never on the server: yesterday in one sentence against your ceiling and floor, what lies ahead (a running, scheduled or usual fast), and at most one nudge when protein or fiber came in under on two of the last three days, naming three foods you have logged before. It never says should, must, only, again or missed, and never mentions weight. A yesterday with no entries reads "Yesterday had no entries. Today starts fresh." The notification opens a catch-up page with the same lines and yesterday's rows. The server only learns that your account wants a wake-up at that time in your time zone, and when a fast reaches its target; the payload carries no text. ([5fb3508](https://github.com/LowCarbCheck/openplate/commit/5fb3508))

### Changed

- **The day's budget rows read plainer, and fat now has a figure.** Protein is orange and fat is plum, so a protein row no longer looks like a red warning and a fat row no longer looks like an amber one. The second line of each row now says which way it means: a ceiling reads "up to 24.9 g more" and a floor reads "12 g still needed", where both used to read as a bare remainder you had to work out. Fat gets a meter of its own when your calorie target, your net carb ceiling and your protein floor are all set, because those three already say what is left for fat; the row is tagged "from your targets" so it is clear nobody set that number for you. Past that figure the fat row says "12 g over" and fills its meter, but it stays plain rather than turning amber, because going over there is the same thing as going over your calories and the calorie row already says so. Set fewer than three targets and the fat row shows the day's grams as before. ([b500d73](https://github.com/LowCarbCheck/openplate/commit/b500d73))
- **The diary calendar now colours every day by your goals.** Opening the date picker in your diary used to show a plain month. Each day is now filled the same way the 13-week grid on Overview and on the progress page fills it, darker the more of your goals you met, with the same legend under it, so one day looks the same wherever you meet it. A screen reader now reads a coloured day as the date plus which step of the four it reached, where it used to read the date alone. The progress page grades its squares against the same targets the other two screens use, so if you are pregnant or breastfeeding the energy your phase adds is counted there too, and a day can no longer be met on one screen and missed on another. ([b500d73](https://github.com/LowCarbCheck/openplate/commit/b500d73))

### Fixed

- **The week tile's bars are no longer links inside the tile link.** Each of the seven bars on Overview's last-7-days tile opened its own day in the diary, a link nested inside the whole tile's own link to your progress, which browsers do not support and could silently break a tap. Tapping a bar no longer opens anything by itself; tapping anywhere on the tile still opens your progress, exactly as before. ([b500d73](https://github.com/LowCarbCheck/openplate/commit/b500d73))
- **The morning catch-up's fat row shows yesterday's real figure.** Yesterday's rows on the catch-up page always read "0 g" for fat, whatever you actually ate, because the page never carried that figure at all. It now reads the same total the diary shows for that day. ([96ded64](https://github.com/LowCarbCheck/openplate/commit/96ded64))
- **Erasing this device now forgets the pulse and push settings too.** Signing out with erase turned on used to leave the pulse opt-in switch and the remembered push subscription behind, so the next account on that device found sharing already on and a stale notification target. Both are now cleared along with the diary. ([96ded64](https://github.com/LowCarbCheck/openplate/commit/96ded64))
- **The pulse tile and the fasting line now appear on a plain reload.** With sharing on, Overview showed no "Today, everyone here" tile and the fasting page said nothing about other fasters, unless you happened to start a fast: the figures were asked for a moment before your account had finished opening, and nothing asked again. They are now read as soon as your account is there, and again the first time you come back to a page you left open for more than five minutes. A device with sharing off asks for nothing at all. ([d4be8b1](https://github.com/LowCarbCheck/openplate/commit/d4be8b1))

## [0.28.0] - 2026-09-11

### Added

- **"Like yesterday" is now a button on the Overview card and on the composer.** Copying a whole day from the day before it only existed in your diary, on the day you were looking at, and a person who eats the same thing most days never went there to look for it. The Overview card and the meal composer now each carry one "Like yesterday" button that copies everything you logged yesterday onto today, with the same Undo the diary offers. It only appears when yesterday has entries and today has fewer, so a day that is already logged looks exactly as it did. The diary section is unchanged and is now called the same thing. ([11b58f7](https://github.com/LowCarbCheck/openplate/commit/11b58f7))
- **Life phase now has its own page, always shown on the hub.** Pregnancy and breastfeeding used to hide inside the goals page, behind the biological sex answer. They now live on their own "Life phase" page, with a row on the settings hub for every account that shows your current phase or "Not active". The dashboard's reminder for a due date links there too. ([1b9ddf5](https://github.com/LowCarbCheck/openplate/commit/1b9ddf5))

### Changed

- **Overview now shows your last 13 weeks and your streak.** The grid of squares, one per day, only lived on the progress page. It is now the second thing on Overview, right under today, with your streak on the line above it. It is the same grid, drawn from the same days, so the two screens can never disagree about a day. Tapping anywhere on it opens the progress page, where the squares stay tappable one by one. Overview scrolls a little further because of it. The two tiles below it, your last 7 days and your weight, open the progress page the same way: tap anywhere on the tile. ([694ef8b](https://github.com/LowCarbCheck/openplate/commit/694ef8b))
- **The Overview week tile draws your last seven days as bars.** The tile showed seven dots, the same dots the diary shows. It now draws one bar per day, as tall as that day stands against your one goal, with a hairline where the goal sits. A day over a ceiling pokes above the line in amber; a day that reached a floor crosses it in teal; a day with nothing logged is a small stub. With no goal set the bars count what you logged and no line is drawn. Every bar still opens that day in your diary, and says its own figure, its goal and the verdict out loud. The link to your progress is now the arrow beside the tile title. ([7cdbd07](https://github.com/LowCarbCheck/openplate/commit/7cdbd07))
- **The goals page splits into "About you" and "Eating and targets".** One page asked how tall you are and how many carbs a day you want, under a single title called Goals. Your height, your birth year, the sex answer and the weigh-in log are now on "About you", with a row to the life phase page, and the eating style and the four targets are on "Eating and targets". The old address still works and sends you to the targets. The card that only linked to the AI settings is gone, the settings hub already lists them. ([bba6ff6](https://github.com/LowCarbCheck/openplate/commit/bba6ff6))
- **The settings hub is grouped around you, and your plan has a row.** The hub had four headings, one of which held your account, sharing, research, the admin page and two lists of your own foods and meals. It now has seven: About you, Eating and targets, Scanning and AI, Appearance and language, Account and plan, My lists and data, and About openplate. On an instance that sells a plan, the plan page is a row on the hub instead of something you find only at the moment a refusal names it. A heading whose rows are all switched off for your instance is no longer drawn over nothing. ([052828f](https://github.com/LowCarbCheck/openplate/commit/052828f))
- **The top bar stays on screen while you scroll.** The bar with the page title and your device menu used to scroll away with the page, so getting back to it meant scrolling all the way up. It now stays at the top of the screen. In your diary the day you are looking at stays too, in a second bar just below it, with the arrows to step a day back or forward, so a long day never leaves you wondering which day you are reading. ([ca9016f](https://github.com/LowCarbCheck/openplate/commit/ca9016f))
- **Messages now appear in the top bar, not in a floating box.** A saved entry, a failed import or a warning used to pop up in a small box over the page, which covered the buttons underneath it and sat on the tab bar on a phone. Those boxes are gone. The message now takes the place of the page title in the top bar, which is always on screen, and it steps aside again after a few seconds. A warning stays a little longer and a failure stays until you close it with the cross beside it. Where a message offers you an Undo, the button sits right there in the bar. On the pages that have no top bar, such as the sign in and welcome screens, the message shows in a bar of its own at the top of the screen. ([7cd2aa7](https://github.com/LowCarbCheck/openplate/commit/7cd2aa7), [a0fba17](https://github.com/LowCarbCheck/openplate/commit/a0fba17))
- **Back now goes up one level, instead of replaying every step.** In the installed app the back gesture, the back key and the edge swipe walked backwards through every tap you had made, so leaving a page you had wandered around in took ten of them. Back now goes up one level: out of a settings page to the settings list, out of an entry to its day. Moving between the tabs at the bottom, stepping through the days in your diary and saving a food no longer add a step to go back through, and going back to a page you were on already returns you to it rather than opening a second copy. Middle click and ctrl or command click still open a link in a new tab. Nothing changes in a browser tab beyond a shorter history. ([bae028e](https://github.com/LowCarbCheck/openplate/commit/bae028e))
- **The terms page now prints your instance's real price and trial length.** The two payment sentences used to show a fixed price and trial length regardless of what the instance actually charges. They now read the deployment's own settings, in your language, and stay hidden if the instance has not set a price at all. ([18fe89d](https://github.com/LowCarbCheck/openplate/commit/18fe89d))
- **The avatar menu now has one settings door and an account strip.** The menu used to show a sync row, a create account row and a settings row at the same weight, so on a phone the account and the settings looked like the same place. Those middle rows are gone. A strip at the foot now shows your email or name, your sync status and your allowance, and is the one place that opens your account page. Signed out, it reads "Signed out" and opens sign in instead. ([058c868](https://github.com/LowCarbCheck/openplate/commit/058c868))

### Fixed

- **A long label beside a reference tag no longer gets clipped.** On a narrow phone or with larger text turned on, a German word like "Ballaststoffe" lost its tail to an ellipsis, or vanished altogether. The label now wraps onto its own line, with the reference tag dropping underneath it, so the full word is always readable. ([7b0528d](https://github.com/LowCarbCheck/openplate/commit/7b0528d))

## [0.27.0] - 2026-09-10

### Added

- **The withdrawal instruction and the model form now have a page.** `/withdrawal` carries the statutory Widerrufsbelehrung and the Muster-Widerrufsformular, which the terms already linked to. The German text is the binding one and follows the model in the EGBGB word for word; the English beside it is a translation, and the page says so. The operator's telephone number is still missing from it, and the page leaves no gap where it belongs. ([72025da](https://github.com/LowCarbCheck/openplate/commit/72025da))

### Changed

- **The scan screen drops a notice nobody could read.** On an instance an organization runs, the camera card told a signed out visitor to sign in before it would take a photo. Signing out closes that screen on that kind of instance, so the sentence was written for a card that never opened. It is gone, and signing out still sends you to the welcome screen as before. ([e2bc608](https://github.com/LowCarbCheck/openplate/commit/e2bc608))
- **The settings pages a visitor may open drop the app shell.** Preferences, Account and About are reachable without an account on an instance an organization runs, so that a visitor can set the language and find the sign in door. They used to arrive wrapped in the full sidebar, the device chip and a back arrow, which read as an app the visitor had never entered. They now wear the public header and footer, with one sentence saying why and links to the start page, the sign in page, the imprint and the privacy page. Anyone with a diary on the device sees the app as before, and on a cold start the page shows the loading screen until it knows which of the two you are, instead of the sidebar. ([3d29c02](https://github.com/LowCarbCheck/openplate/commit/3d29c02), [f901139](https://github.com/LowCarbCheck/openplate/commit/f901139))

## [0.26.0] - 2026-09-09

### Added

- **An instance that sells a plan now has a plan page.** `/settings/plan` shows what your account pays for, when the paid period ends, whether it renews, and gives you the two buttons that start a plan and open the payment portal, where cancelling, changing a card and downloading an invoice live. It is reachable from the photo estimates card on your account page. On an instance with no biller behind it the address is not a page at all, which is what the server itself answers. ([a2d0cbf](https://github.com/LowCarbCheck/openplate/commit/a2d0cbf))
- **A refusal that a plan would fix now points at the plan page.** When photo estimates stop because a trial ended, the notice under the composer and the message on the scan screen offer the plans, instead of naming an administrator who does not exist. An instance an organization runs is unchanged, and so is an instance that sells nothing. ([a2d0cbf](https://github.com/LowCarbCheck/openplate/commit/a2d0cbf))
- **The terms and the privacy policy describe the payment.** Where an instance takes a card, the terms gain a section on what is sold, how it renews, how it is cancelled, what happens when a payment fails, and your right of withdrawal, and the privacy policy gains a section naming the payment processor, what it receives, and why an invoice is kept for ten years after an account is erased. Neither section appears on an instance with no biller. ([a2d0cbf](https://github.com/LowCarbCheck/openplate/commit/a2d0cbf))

### Fixed

- **The German privacy policy's account section now speaks Sie, like the rest of the page.** Six sentences under "Your account and your devices" shipped in the du register on a page that otherwise addresses you formally. ([2747bef](https://github.com/LowCarbCheck/openplate/commit/2747bef))

## [0.25.0] - 2026-09-09

### Added

- **Your account page now shows when your photo estimates end.** An account whose allowance carries an end date sees that date beside the daily count, in your own date format. An account with no end date, which is what a self-hosted instance keeps, sees nothing new. ([6978b5b](https://github.com/LowCarbCheck/openplate/commit/6978b5b))
- **An account can invite people, where the instance offers it.** A card on the account page takes an email address and says how many invitations you have left. The reply is the same sentence whatever is true about the address, on purpose: nobody can use it to find out who already has an account here. The instance decides whether the card appears at all, and the count you see is drawn, never trusted. ([6978b5b](https://github.com/LowCarbCheck/openplate/commit/6978b5b))
- **The terms and the privacy policy now describe an instance that runs the AI for you.** Five sentences and two headings still promised that your plate photo goes to a provider you chose and never passes through our servers, which has been false on an instance run for you since it launched. Each one now has a version written for that instance. The terms state that the allowance ends on a date, and the privacy policy states that an address you type into an invitation reaches us and is kept until the invitation is redeemed, revoked or expires. Section 6 also names the two new things an administrator can see: when your allowance ends, and how many invitations you have left. ([386a84f](https://github.com/LowCarbCheck/openplate/commit/386a84f))

### Fixed

- **A refused photo estimate now says which of two things happened.** An allowance that ended on a date and an instance that has read all the photos it can today used to arrive as "the provider is temporarily unavailable, try again in a moment". The first was never temporary, and the second comes back tomorrow rather than in a moment. Each now has its own sentence, and the one about an ended allowance names the date. ([6978b5b](https://github.com/LowCarbCheck/openplate/commit/6978b5b))
- **No screen tells you to ask an administrator who does not exist.** On an instance where accounts invite each other there is nobody to ask, so the three sentences that sent you to one now say what is true of your account instead: the date your allowance ended, or simply that photo estimates are not switched on for it. An instance an organization runs still names the administrator, who is a real person there. ([6978b5b](https://github.com/LowCarbCheck/openplate/commit/6978b5b))

## [0.24.0] - 2026-09-09

### Added

- **The app now opens by asking how you eat, and every goal follows from that answer.** The first setup step lists five eating styles: low carb, low carb and calories, calories, high protein, and just track. Nothing is picked for you, and there is no Skip, because "just track" is the answer for anyone who wants no goal at all. A carb style then asks for a daily limit of 20, 50 or 100 g and a calorie style asks for a target, both required, so no goal is ever invented from a blank field. High protein sets your protein goal from your weight, and says so if there is no weight on file yet. If a pregnancy or a breastfeeding period is already recorded on the device, a note with a source link appears under the list for the three styles that restrict carbs or calories. The profile stores your pick from now on, so a backup taken from now on needs this version or newer to import; a profile written earlier keeps its numbers untouched and the app reads a style back out of them. ([a7e65e9](https://github.com/LowCarbCheck/openplate/commit/a7e65e9), [c772c8b](https://github.com/LowCarbCheck/openplate/commit/c772c8b))
- **Goals in Settings lets you change your eating style later.** The page opens with a style card listing the same five styles. Saving keeps the numbers your style uses and clears the ones it does not, and the goal numbers below stay yours to fine tune afterwards. Re-saving the style you already have leaves your own numbers alone. The pregnancy and breastfeeding note appears here too, with no number changed. ([2c368af](https://github.com/LowCarbCheck/openplate/commit/2c368af))
- **A search that finds nothing now offers each part of it as a button.** Typing "Kaffee mit Hafermilch" searched the whole phrase, which no food database holds, and left you with nothing. When a search joins two foods with a word like mit, und, with or and, and finds no good match, the screen now offers "Kaffee" and "Hafermilch" as buttons that search each one on their own. A search that says what you did not eat, such as "Salat ohne Hähnchen", is never split. ([e46020c](https://github.com/LowCarbCheck/openplate/commit/e46020c))

### Changed

- **The day now gets one grade, the one your eating style asks for.** A low carb style still gets the carb verdict, a calorie style gets a calorie one, a high protein style gets its floor, and "just track" gets no grade at all. A day with no carb goal used to be graded against a hidden 50 gram line that was never shown to you. That line is gone. ([d22ccc0](https://github.com/LowCarbCheck/openplate/commit/d22ccc0))
- **The meal composer drops a notice nobody could read.** On an instance an organization runs, "Describe a meal" and "Add food" told a signed out visitor to sign in before the AI could read their words. Signing out closes both screens on that kind of instance, so the sentence was written for a screen that never opened. It is gone, and signing out still sends you to the welcome screen as before. ([5d1940c](https://github.com/LowCarbCheck/openplate/commit/5d1940c))

### Fixed

- **Goals in Settings shows the numbers a style save just wrote.** Saving an eating style cleared the goals it does not use, but the goal card underneath kept printing the old daily carb limit until you left the page and came back. Both cards now redraw from what is stored, in either direction: changing your goals also re-ticks the style card. Your eating style follows those numbers too. Setting a daily carb limit while your style was calories left the style card saying calories and the day graded on calories alone; the style now moves to the one your numbers describe. A high protein style stays as it is while its protein goal is still set, because a carb limit typed beside it is extra information, not a new goal. ([725d689](https://github.com/LowCarbCheck/openplate/commit/725d689), [cd91545](https://github.com/LowCarbCheck/openplate/commit/cd91545))

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
