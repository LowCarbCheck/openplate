# The text of the declaration letters

`POST /v1/legal/declarations` takes a cancellation (§ 312k BGB) or a withdrawal
(§ 356a BGB), stores it, and mails two letters: a receipt to the person who
filed it and an alert to `MAIL_OPERATOR_EMAIL`. This page says where the words
of those two letters come from, and what goes out when there are none.

This service ships no letter text of its own beyond a neutral fallback. The
words are yours: you write them, you have them reviewed, and you mount them.

## Where the files go

Set `CONTENT_DIR` to a folder, and mount that folder read-only into the
container. It is the same variable, and can be the same folder, the openplate
app reads its legal pages from. This service reads four files from it:

| File                                            | Languages | Placeholders                                              |
| ----------------------------------------------- | --------- | --------------------------------------------------------- |
| `<lang>/mail/declaration-receipt-kuendigung.md` | all six   | `{{date}}`, `{{details}}`                                 |
| `<lang>/mail/declaration-receipt-widerruf.md`   | all six   | `{{date}}`, `{{details}}`                                 |
| `<lang>/mail/declaration-alert-kuendigung.md`   | `en`      | `{{date}}`, `{{receiptId}}`, `{{details}}`, `{{matched}}` |
| `<lang>/mail/declaration-alert-widerruf.md`     | `en`      | `{{date}}`, `{{receiptId}}`, `{{details}}`, `{{matched}}` |

The service sends the receipt in the language of the submitted form: `en`, `de`, `fr`, `it`, `es` or `tr`. When that file is missing or rejected, the service uses the German file, then the English file. A folder containing only German and English receipts still sends a message to every recipient. The operator alert is English only.

## What a file looks like

UTF-8, LF line ends, no byte order mark. The file starts with exactly this
front matter, in this order:

```
---
title: A name for the file
updated: 2026-09-23
subject: The subject line of the mail
---
```

`subject` is plain text and may use the file's placeholders. `title` is not
sent. `updated` must be a real date.

The body uses a small subset of markdown: `##` and `###` headings,
paragraphs, `- ` and `1. ` lists one level deep, `**strong**`, `*emphasis*`,
links whose target starts with `/`, `https://`, `mailto:` or `tel:`, a
backslash at the end of a line for a line break, a definition list (a term
line followed by `: definition` lines), and `\` before `\`, `*`, `[` or `]`
for a literal character.

The placeholders:

- `{{date}}` is the time of receipt in Europe/Berlin with its zone name, for
  example `21 September 2026 at 12:15 CEST`, in the file's language.
- `{{receiptId}}` is the receipt number the person's confirmation page shows.
- `{{details}}` must stand alone on its line. It becomes one paragraph per
  field the person filled in, as `Label: value`, in the order the form asks
  for them. The labels are in the file's language and live in this service's
  code.
- `{{matched}}` is `yes` or `no`: whether the typed address belongs to an
  account on this instance.

What a person typed is always inserted as plain text. A `**` or a link in a
form field stays literal in the mail, and the HTML part escapes it.

Receipts omit the submitted name, contract or customer number, and reason.
For each completed field, the receipt shows
`Label: received, not repeated in this email` in the file's language. Because
anyone can enter an arbitrary email address, the receipt must not echo user
input. The operator alert includes every field word for word.

## When a file is refused

Anything outside the subset refuses the whole file: raw HTML, an HTML
character reference such as `&amp;`, an image, a code span or block, a block
quote, a table, a `#` or `####` heading, an indented line, a placeholder the
file may not use, or a front matter that is not exactly the three keys above.

A refused file is never sent in part. The letter falls back to the next
language, and then to the neutral text below. The service logs one `warn` line
per refused or missing file, with the template name, the language and the
rule it broke, and never the file's content:

```
Declaration mail template not used  template=declaration-receipt-widerruf language=de reason="the file is missing"
```

Each send also logs `text=template` or `text=fallback`, so you can see which
one went out.

## The neutral fallback

With `CONTENT_DIR` unset, or with no usable file, the letters carry the facts
the statutes require and nothing else: no greeting, no promise, no outcome.
The labels are the ones the app's confirmation page shows.

The receipt, in English:

```
Subject: Cancellation confirmed          (or: Withdrawal confirmed)

Type: Cancellation                       (or: Type: Withdrawal)

Receipt no.: <receipt id>

Received at: <date>

<one "Label: value" paragraph per field the person gave, the name, the
contract number and the reason as "received, not repeated in this email">

If you did not send this, contact the business you have the contract with to reverse the declaration.
```

The receipt, in German:

```
Subject: Kündigung bestätigt             (or: Widerruf bestätigt)

Art: Kündigung                           (or: Art: Widerruf)

Beleg-Nr.: <receipt id>

Eingegangen am: <date>

<one "Label: value" paragraph per field the person gave, the name, the
contract number and the reason as "erhalten, in dieser E-Mail nicht wiederholt">

Wenn Sie dies nicht gesendet haben, kontaktieren Sie das Unternehmen, mit dem Sie den Vertrag haben, um die Erklärung rückgängig zu machen.
```

Only the fallback uses the last line. You write the template's closing. Consider instructing readers who did not submit the form, because the receipt goes to whatever address was typed.

The French, Italian, Spanish and Turkish receipts use the same text lines, with labels matching the app confirmation page in that language.

The operator alert, in English:

```
Subject: New declaration: cancellation (<receipt id>)   (or: withdrawal)

Type: Cancellation

Receipt no.: <receipt id>

Received at: <date>

<one "Label: value" paragraph per field the person gave, word for word>

Matched to an existing account: yes.     (or: no.)
```

## When a receipt is not sent

The form requires no login. To limit abuse, receipts follow three daily
ceilings calculated over the trailing 24 hours:

- one mailbox receives at most 3 receipts;
- one sender network (an IPv4 address or an IPv6 /64) triggers at most
  `LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY` receipts, which defaults to 10;
- the entire instance sends at most `LEGAL_DECLARATION_RECEIPTS_PER_DAY`
  receipts, which defaults to 200.

If a submission exceeds any ceiling, the system still stores the declaration,
forwards it, and sends the operator alert. Only the user receipt is skipped.
The user sees the same response from the form. The service logs a single `warn`
line containing the receipt number and the ceiling type, but never the email
address:

```
Skipped a declaration receipt over a daily ceiling  receiptId=<receipt id> ceiling=network cap=10
```

The service calculates mailbox and instance totals from stored declarations.
It stores the network count in memory, which resets on a restart.

## Editing a mounted file

The service checks each file's modification time and size on every letter and
reads it again when either changed. An edit shows on the next declaration,
with no restart. A missing or unreadable folder never stops the service or
delays a letter; the declaration is stored before any mail is built.
