# Import from YAZIO

If you kept a food diary in [YAZIO](https://www.yazio.com/) and want to move it into openplate,
follow these steps. Install one export tool, run three commands, then select the exported files
on openplate's **Data & backup** screen. You do not need developer experience beyond typing
commands into a terminal.

Every food you logged in YAZIO lands in openplate on the day and in the meal you logged it,
with its macros scaled to the amount you ate. Read "What comes across and what does not" below
before you import, because a few values read differently than they did in YAZIO.

## What you need

- Your YAZIO email and password.
- A computer where you can open a terminal and install Python. A phone will not work for the
  export step. You can move the two files to your phone afterward if you use openplate there.
- [Python](https://www.python.org/) 3.11 or newer.
- openplate open in a browser, on the same device or on a device you can copy two files to.

## Get your diary out of YAZIO

openplate does not talk to YAZIO directly. You run a separate, open-source command line tool
called `yazio-exporter`. It reads your YAZIO diary and writes it to two files on your computer.

**`yazio-exporter` is a third-party tool.** openplate and YAZIO did not make it, and nobody
involved in openplate maintains it. It can stop working if YAZIO changes its app. The project
is at
[github.com/aleksandr-bogdanov/yazio-exporter](https://github.com/aleksandr-bogdanov/yazio-exporter).

1. **Install Python 3.11 or newer**, if you do not have it yet. The
   [python.org downloads page](https://www.python.org/downloads/) has installers for Windows,
   macOS, and Linux.
2. **Open a terminal** and install the export tool:

   ```bash
   pip install yazio-exporter
   ```

3. **Log in, then export your days and products:**

   ```bash
   yazio-exporter login you@example.com your-password
   yazio-exporter days
   yazio-exporter products
   ```

   Replace `you@example.com` and `your-password` with your YAZIO sign-in details. This command
   connects only to YAZIO's server, `yzapi.yazio.com`. Nothing goes to openplate during this
   step.

   The `login` command saves a token to a file named `token.txt` in your current folder. The
   `days` and `products` commands use this file so they do not ask for your password again.
   Your system creates this file readable only by your user account, but it is not encrypted.
   Delete `token.txt` once you finish the export.

   **Your password remains in your terminal command history**, because `yazio-exporter` takes
   it as plain text on the command line rather than at a hidden prompt. On macOS and Linux, you
   have two ways to keep it out: type a space before the command if your shell ignores lines
   starting with a space, or run `history -c` right after to clear your session history. On
   Windows, closing PowerShell does not clear it. PowerShell's PSReadLine module keeps a
   persistent history file at
   `%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`. Open that file
   afterward and delete the line with your password.

4. **Find the two files.** `yazio-exporter days` writes `days.json`. `yazio-exporter products`
   writes `products.json`. Both files appear in the folder where you ran the commands. You need
   both.

## Import into openplate

1. Open openplate and go to **Settings**, then **Data & backup**.
2. Under **Import from YAZIO**, select **Choose the YAZIO files**.
3. In the file picker, select both `days.json` and `products.json` together, then confirm your
   selection.
4. openplate reads the two files on your device and displays a preview. It shows the number of
   entries it will add, the number of days they cover, the first and last day, and any skipped
   items with the reason. If some of these days already have entries in your openplate diary,
   the preview shows how many. After the import, those days show both your own entries and the
   imported ones. Nothing is written to your diary yet.
5. Review the preview, then select **Add to my diary**. Select **Cancel** to stop without
   changing anything.
6. openplate confirms how many entries it imported. Open your diary and verify a day you
   remember.

The two files stay on your device. openplate reads them locally in your browser and does not
upload them to a server.

## What comes across and what does not

- **Each food becomes its own entry**, on the day and in the meal you logged it in YAZIO.
- **A nutrient YAZIO does not carry shows as unknown in openplate, never as zero.** YAZIO has no
  fibre value for many foods. When that happens, openplate marks fibre as unknown instead of
  zero.
- **openplate treats YAZIO's carb number as already excluding fibre, the EU style, and does not
  subtract fibre again.** Nobody knows for certain which style YAZIO uses. If YAZIO's number
  actually includes fibre, the US style, your net carbs in openplate will read higher than they
  really are, never lower. That is the safer error for a low-carb tracker.
- **An amount in millilitres counts as the same number of grams.** openplate stores weight only
  in grams.
- **Quick entries are skipped.** When you enter calories in YAZIO without choosing a food, the
  entry contains no macro data for openplate to read.
- **An entry is skipped when its food is missing from `products.json`.** This usually happens
  when YAZIO's database no longer has the food, so the export lists the diary entry without its
  nutrients. A food you deleted from your YAZIO diary is not skipped, because it is not in the
  export at all.
- **A recipe's weight comes from the sum of its ingredients.** A recipe without an ingredient
  list in the export file is skipped. Recipe numbers are the least certain part of this import,
  so check an imported recipe against YAZIO.
- **Importing the same two files again updates existing entries instead of creating
  duplicates.** This overwrites manual edits you made to an imported entry, and it restores an
  imported entry you deleted if that item remains in the files.

## If it goes wrong

openplate verifies the files before it displays a preview. Here is what each message means:

- **"One of those files isn't valid JSON. Pick the days.json and products.json the exporter
  wrote."** One of the files is not valid JSON. Select the files exactly as `yazio-exporter`
  created them, without edits.
- **"One of those files isn't a YAZIO export. Pick only days.json and products.json."** One
  file is valid JSON but does not contain YAZIO export data. Check that you selected the
  correct files.
- **"You picked two files of the same kind. Pick one days.json and one products.json."** You
  selected duplicate files, such as two copies of `days.json`. Select one of each.
- **"days.json is missing. Pick it together with products.json."** You selected only
  `products.json`. Select both files together.
- **"products.json is missing. Pick it together with days.json."** You selected only
  `days.json`. Select both files together.

If the preview reports skipped entries, see "What comes across and what does not" above for
details.
