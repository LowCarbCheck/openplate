# Content pages

openplate draws its legal pages from markdown files that you mount into the
container. The repository holds no legal text of its own. The terms, the
privacy policy, the imprint and the pages for the two statutory buttons are
yours to write, because they describe your instance and name you as the
operator.

## Turning it on

Set `CONTENT_DIR` to a folder that the app can read:

```sh
CONTENT_DIR=/srv/openplate-content
```

With a container, mount the folder read only and point the variable at the
mount:

```yaml
services:
  openplate:
    environment:
      CONTENT_DIR: /content
    volumes:
      - ./content:/content:ro
```

A value that names no folder stops the boot. A failed mount then shows at
once, and it cannot look like an instance with no legal pages.

## With `CONTENT_DIR` unset

This is the default, and it suits a household instance that sells nothing.

- Every content route answers 404: `/terms`, `/privacy`, `/privacy/website`,
  `/imprint`, `/withdrawal`, `/kuendigung`, `/kuendigung/bestaetigt`,
  `/widerrufen` and `/widerrufen/bestaetigt`.
- The public footer draws Source, Licence and Preferences only. The five legal
  links (Privacy, Terms, Imprint and the two statutory buttons) are not drawn.
- The note a signed-out visitor sees on a personal page links home and to sign
  in, with no imprint or privacy link.
- The newsletter form, if you turned it on, drops its privacy line.

The links come back when the folder holds an `imprint.md`, in the reader's
language or in English. The imprint is the probe because German law wants it
on every instance that publishes any of the others.

## The folder

```
<CONTENT_DIR>/
  en/
    terms.md
    privacy.md
    imprint.md
    ...
  de/
    terms.md
    ...
```

One folder per language: `en`, `de`, `fr`, `it`, `es` or `tr`. One file per
page, named by its slug:

| Slug | Path in the app |
| --- | --- |
| `terms` | `/terms` |
| `privacy` | `/privacy` |
| `privacy-website` | `/privacy/website` |
| `imprint` | `/imprint` |
| `withdrawal` | `/withdrawal` |
| `kuendigung` | `/kuendigung` |
| `kuendigung-bestaetigt` | `/kuendigung/bestaetigt` |
| `widerrufen` | `/widerrufen` |
| `widerrufen-bestaetigt` | `/widerrufen/bestaetigt` |

A page that is missing in the reader's language is served in English. A page
that is missing in English too is a 404. The app reads only these slugs, and
it never builds a path from a URL.

The app reads each file on request and keeps the parsed page in memory. It
reads the file again when its modification time or size changes, so an edit to
a mounted file shows on the next request without a restart.

## The file format

UTF-8, LF line ends, no byte order mark. Each file starts with exactly this
front matter:

```
---
title: Terms of service
updated: 2026-09-21
---
```

`title` is the page heading. `updated` is a calendar date, and the app draws it
under the heading as "Last updated", in the reader's language. Do not repeat
either one in the body.

The body uses this subset and nothing else:

- Headings `##` and `###`. `#` is the title and is never written.
- Paragraphs, separated by a blank line.
- Lists with `- ` or `1. `, one level, no indentation.
- `**strong**` and `*emphasis*`.
- Links `[text](target)`. The target is a path in the app (`/imprint`),
  `https://`, `mailto:` or `tel:`. A path in the app opens without a reload.
- A hard line break: a backslash as the last character of a line, followed by
  the next line of the same paragraph. Use it for a postal address.
- A definition list: a term line followed by one or more `: definition` lines,
  with no blank line between the entries.
- An escape: a backslash before `\`, `*`, `[` or `]` makes it literal.

Paragraphs before the first heading are the page's lead and are drawn larger.

### What is refused

Raw HTML of any kind (a `<` followed by a letter, `/`, `!` or `?`), HTML
character references such as `&amp;`, images, tables, code, block quotes,
`#` or `####` headings, nested or indented lists, and any `{{` placeholder.

A file that breaks the format is **refused, not repaired**. The app logs every
problem with its line number, once per version of the file, and the page
answers 503 with the app's neutral error screen. A legal page that silently
dropped a table, or printed a tag as text, would publish a document nobody
wrote. Fix the file, and the next request serves it.

## Named sections

Two pages keep a form in the app's code: `/kuendigung` (cancel a contract) and
`/widerrufen` (withdraw from a contract). Their confirmation pages keep the
receipt in code. The form labels, the buttons, the validation messages and the
receipt lines are part of the app. The prose around them comes from the file.
A named section carries each piece the app places around the form:

```
:::section unavailable
Text of the section, in the same subset.
:::
```

Each of these pages must carry exactly the sections below, once each. A
missing section or an extra one is refused like any other error.

| Slug | Section | Where the app draws it |
| --- | --- | --- |
| `kuendigung` | (body) | The lead, above the cancellation form. |
| `kuendigung` | `unavailable` | In place of the form when `SYNC_SERVER_URL` is unset, and under the submit button when a submission cannot reach the declaration service. |
| `kuendigung-bestaetigt` | (body) | Usually empty. |
| `kuendigung-bestaetigt` | `mail-notice` | After the receipt lines, before the print button. |
| `widerrufen` | (body) | The lead, above the withdrawal form. |
| `widerrufen` | `unavailable` | As for `kuendigung`. |
| `widerrufen-bestaetigt` | (body) | Usually empty. |
| `widerrufen-bestaetigt` | `mail-notice` | As for `kuendigung-bestaetigt`. |

Every other page has no sections: its whole body is the page.

The title of `kuendigung` is the label the German statute requires for that
page, and the same goes for `widerrufen`. The app's footer and submit buttons
carry the statutory button labels themselves.

## Where the openplate instances get their files

The hosted instances mount files kept in a private repository, one tree per
instance. That repository checks every file against this format before it
ships, so a refused page is caught before it reaches a server.
