/**
 * The content file parser (`app/lib/content/markdown.ts`, M246 spec 01).
 *
 * The file format is `openplate-billing/legal/CONTRACT.md`, restated for a
 * self-hoster in `docs/content.md`. Every rule below is a case that refuses a
 * file, and EVERY REFUSAL HAS A CONTROL: the nearest input that the rule must
 * let through. A parser that refused everything would pass the refusals alone,
 * and one that refused nothing would pass the controls alone.
 *
 * No legal prose here: the inputs are neutral placeholder text, because this
 * repository is public and the real files are not.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ContentRefusedError,
  isAllowedContentHref,
  parseContentDocument,
  sectionBlocks,
  type ContentBlock,
  type ContentDocument,
} from '../../app/lib/content/markdown';

const FRONT = '---\ntitle: A fixture page\nupdated: 2026-01-15\n---\n';

/** A whole file: the standard front matter, then `body`. */
function file(body: string): string {
  return `${FRONT}\n${body}`;
}

function parse(source: string, sections: readonly string[] = []): ContentDocument {
  return parseContentDocument({ source, sections });
}

/** The messages a refused file carries; fails the test when the file was accepted. */
function refusal(source: string, sections: readonly string[] = []): string[] {
  try {
    parse(source, sections);
  } catch (error) {
    assert.ok(error instanceof ContentRefusedError, `expected a ContentRefusedError, got ${String(error)}`);
    return error.problems.map((problem) => problem.message);
  }
  assert.fail('the file was accepted');
}

function assertRefused(input: { source: string; because: RegExp; sections?: readonly string[] }): void {
  const messages = refusal(input.source, input.sections);
  assert.ok(
    messages.some((message) => input.because.test(message)),
    `expected a problem matching ${input.because}, got: ${messages.join(' | ')}`,
  );
}

function firstBlock(source: string): ContentBlock {
  const [block] = parse(source).body;
  assert.ok(block !== undefined, 'the body has no block');
  return block;
}

describe('a well-formed file', () => {
  it('reads the front matter and every kind of block', () => {
    const document = parse(
      file(
        [
          'A lead paragraph with **strong**, *emphasis* and a [link](/imprint).',
          '',
          '## A heading',
          '',
          '### A subheading',
          '',
          '- one',
          '- two',
          '',
          '1. first',
          '2. second',
          '',
          'Term',
          ': Definition one',
          ': Definition two',
          'Other term',
          ': Other definition',
          '',
        ].join('\n'),
      ),
    );
    assert.equal(document.title, 'A fixture page');
    assert.equal(document.updated, '2026-01-15');
    assert.deepEqual(
      document.body.map((block) => block.kind),
      ['paragraph', 'heading', 'heading', 'list', 'list', 'definitions'],
    );
    assert.deepEqual(document.body[0], {
      kind: 'paragraph',
      children: [
        { kind: 'text', text: 'A lead paragraph with ' },
        { kind: 'strong', children: [{ kind: 'text', text: 'strong' }] },
        { kind: 'text', text: ', ' },
        { kind: 'emphasis', children: [{ kind: 'text', text: 'emphasis' }] },
        { kind: 'text', text: ' and a ' },
        { kind: 'link', href: '/imprint', children: [{ kind: 'text', text: 'link' }] },
        { kind: 'text', text: '.' },
      ],
    });
    assert.deepEqual(document.body[3], {
      kind: 'list',
      isOrdered: false,
      items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]],
    });
    assert.equal(document.body[4]?.kind === 'list' && document.body[4].isOrdered, true);
    const definitions = document.body[5];
    assert.ok(definitions?.kind === 'definitions');
    assert.equal(definitions.entries.length, 2);
    assert.equal(definitions.entries[0]?.definitions.length, 2);
  });

  it('joins the lines of a paragraph with a space, and a trailing backslash with a hard break', () => {
    assert.deepEqual(firstBlock(file('Line one\nline two\\\nline three\n')), {
      kind: 'paragraph',
      children: [{ kind: 'text', text: 'Line one line two' }, { kind: 'break' }, { kind: 'text', text: 'line three' }],
    });
  });

  it('reads an escaped character as that character', () => {
    assert.deepEqual(firstBlock(file('A \\* star, a \\[bracket\\] and a \\\\ backslash\n')), {
      kind: 'paragraph',
      children: [{ kind: 'text', text: 'A * star, a [bracket] and a \\ backslash' }],
    });
  });

  it('CONTROL: an escaped backslash at the end of a line is a backslash, not a hard break', () => {
    assert.deepEqual(firstBlock(file('Ends with \\\\\nnext\n')), {
      kind: 'paragraph',
      children: [{ kind: 'text', text: 'Ends with \\ next' }],
    });
  });

  it('files the text of each named section under its name', () => {
    const document = parse(file('Body text.\n\n:::section unavailable\nSection text.\n:::\n'), ['unavailable']);
    assert.equal(document.body.length, 1);
    assert.deepEqual(sectionBlocks(document, 'unavailable'), [
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Section text.' }] },
    ]);
  });
});

describe('raw HTML is refused, never escaped into view', () => {
  for (const [what, body] of [
    ['a script element', '<script>alert(1)</script>'],
    ['a line break tag', 'Text<br>more'],
    ['a closing tag', 'Text</p>'],
    ['a comment', '<!-- note -->'],
    ['a processing instruction', '<?xml version="1.0"?>'],
    ['a tag inside link text', '[<b>x</b>](/imprint)'],
    ['a tag inside a list item', '- <img src=x onerror=alert(1)>'],
    ['a tag inside a named section', ':::section unavailable\n<em>x</em>\n:::'],
  ] as const) {
    it(`refuses ${what}`, () => {
      assertRefused({ source: file(`${body}\n`), because: /raw HTML/, sections: ['unavailable'] });
    });
  }

  it('refuses a tag in the title', () => {
    assertRefused({ source: '---\ntitle: A <b>page</b>\nupdated: 2026-01-15\n---\n', because: /raw HTML/ });
  });

  it('CONTROL: a lone angle bracket before a digit or a space is text', () => {
    assert.deepEqual(firstBlock(file('Less than < 5 g, and 3 <4.\n')), {
      kind: 'paragraph',
      children: [{ kind: 'text', text: 'Less than < 5 g, and 3 <4.' }],
    });
  });

  it('refuses an HTML character reference', () => {
    assertRefused({ source: file('Fish &amp; chips\n'), because: /character reference/ });
    assertRefused({ source: file('A dash &#8212; here\n'), because: /character reference/ });
  });

  it('CONTROL: a bare ampersand is text', () => {
    assert.equal(firstBlock(file('Fish & chips\n')).kind, 'paragraph');
  });
});

describe('a link goes only where the contract allows', () => {
  for (const target of ['javascript:alert(1)', 'data:text/html,x', 'http://example.org', '//example.org', '/\\example.org', 'ftp://x', 'imprint']) {
    it(`refuses ${target}`, () => {
      assertRefused({ source: file(`[text](${target})\n`), because: /link target|starts no/ });
    });
  }

  it('CONTROL: an app path, https, mailto and tel are accepted', () => {
    for (const target of ['/imprint', 'https://example.org/a', 'mailto:someone@example.org', 'tel:+000']) {
      assert.equal(isAllowedContentHref(target), true, target);
      assert.equal(firstBlock(file(`[text](${target})\n`)).kind, 'paragraph', target);
    }
  });

  it('refuses a bracket that starts no link, and a stray closing bracket', () => {
    assertRefused({ source: file('A [bracket alone\n'), because: /starts no/ });
    assertRefused({ source: file('A bracket] alone\n'), because: /outside a link/ });
  });
});

describe('every construct outside the subset is refused', () => {
  for (const [what, body, because] of [
    ['an image', '![alt](/x.png)', /image/],
    ['a code span', 'Use `code` here', /code span/],
    ['a code fence', '```\ncode\n```', /code fence/],
    ['a block quote', '> quoted', /block quote/],
    ['a table', '| a | b |', /table/],
    ['a level one heading', '# Title again', /headings are allowed/],
    ['a level four heading', '#### Deep', /headings are allowed/],
    ['an indented line', '    indented code', /indented/],
    ['a nested list', '- one\n  - nested', /indented/],
    ['a star bullet', '* item', /bullet is written/],
    ['a placeholder', 'Hello {{name}}', /placeholder/],
    ['a run of three asterisks', '***bold italic***', /asterisks/],
    ['an unclosed emphasis', 'An *open emphasis', /never closed/],
    ['crossed markers', '**a *b** c*', /closes across/],
    ['a hard break that ends a paragraph', 'Last line\\', /followed by a line/],
    ['a hard break in a list item', '- item\\\n- next', /belongs inside a paragraph/],
    ['a list item carried on to a new line', '- item\ncontinued', /own line/],
    ['a definition with no term', ': orphan definition', /must follow a term/],
    ['a term with no definition', 'Term\n: def\nLonely term', /must be followed/],
    ['a backslash before an ordinary letter', 'A \\q here', /may only escape/],
  ] as const) {
    it(`refuses ${what}`, () => {
      assertRefused({ source: file(`${body}\n`), because });
    });
  }

  it('lists every problem in one refusal, each with its line', () => {
    try {
      parse(file('<b>one</b>\n\n![two](/x.png)\n'));
      assert.fail('accepted');
    } catch (error) {
      assert.ok(error instanceof ContentRefusedError);
      assert.deepEqual(
        error.problems.map((problem) => problem.line),
        [6, 8],
      );
      assert.match(error.message, /line 6: raw HTML/);
    }
  });
});

describe('the front matter', () => {
  it('refuses a file with none', () => {
    assertRefused({ source: 'Just text\n', because: /start with a front matter/ });
  });

  it('refuses a front matter that is never closed', () => {
    assertRefused({ source: '---\ntitle: x\nupdated: 2026-01-15\n', because: /never closed/ });
  });

  it('refuses a missing, an extra or a reordered key', () => {
    assertRefused({ source: '---\ntitle: x\n---\n', because: /exactly title, updated/ });
    assertRefused({ source: '---\ntitle: x\nupdated: 2026-01-15\nauthor: y\n---\n', because: /exactly title, updated/ });
    assertRefused({ source: '---\nupdated: 2026-01-15\ntitle: x\n---\n', because: /exactly title, updated/ });
  });

  it('refuses a date that is not on the calendar', () => {
    assertRefused({ source: '---\ntitle: x\nupdated: 2026-02-30\n---\n', because: /calendar date/ });
    assertRefused({ source: '---\ntitle: x\nupdated: 15.01.2026\n---\n', because: /calendar date/ });
  });

  it('refuses markup in the title', () => {
    assertRefused({ source: '---\ntitle: A *page*\nupdated: 2026-01-15\n---\n', because: /plain text/ });
  });

  it('refuses CR line ends and a byte order mark', () => {
    assertRefused({ source: FRONT.replaceAll('\n', '\r\n'), because: /CR line ends/ });
    assertRefused({ source: `﻿${FRONT}`, because: /byte order mark/ });
  });

  it('CONTROL: the front matter alone is a valid page with an empty body', () => {
    assert.deepEqual(parse(FRONT), { title: 'A fixture page', updated: '2026-01-15', body: [], sections: [] });
  });
});

describe('named sections', () => {
  it('refuses a page that lacks a section it must carry', () => {
    assertRefused({ source: file('Body only.\n'), sections: ['unavailable'], because: /"unavailable" is missing/ });
  });

  it('refuses a section the page does not carry', () => {
    assertRefused({ source: file(':::section other\nText\n:::\n'), because: /not one this page carries/ });
  });

  it('refuses a section that appears twice, one inside another, and one never closed', () => {
    const twice = ':::section unavailable\nA\n:::\n\n:::section unavailable\nB\n:::\n';
    assertRefused({ source: file(twice), sections: ['unavailable'], because: /appears twice/ });
    const nested = ':::section unavailable\n:::section mail-notice\nB\n:::\n:::\n';
    assertRefused({ source: file(nested), sections: ['unavailable', 'mail-notice'], because: /opens inside/ });
    assertRefused({ source: file(':::section unavailable\nA\n'), sections: ['unavailable'], because: /never closed/ });
  });

  it('refuses a stray closing line and a malformed opening', () => {
    assertRefused({ source: file(':::\n'), because: /closes no open section/ });
    assertRefused({ source: file(':::note\nA\n:::\n'), because: /section line reads/ });
  });

  it('CONTROL: asking for a section the parser never declared is a code error, not a file error', () => {
    const document = parse(file('Body.\n'));
    assert.throws(() => sectionBlocks(document, 'unavailable'), /no section "unavailable"/);
  });
});
