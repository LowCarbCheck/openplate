/**
 * The renderer for a content page (`app/components/content-article.tsx`,
 * M246 spec 01): a parsed tree in, React elements out.
 *
 * The trees here are built by hand rather than parsed, on purpose. The parser
 * refuses raw HTML and a bad link target before a tree exists, so the only way
 * to ask the RENDERER what it does with one is to hand it a tree the parser
 * would never produce. That is the second lock: a tree that reached the client
 * some other way still cannot inject markup or a `javascript:` link.
 *
 * Rendered inside a memory data router, because an app path is drawn with the
 * router's `Link`, which needs one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { ContentArticle, ContentBlocks } from '../../app/components/content-article';
import { parseContentDocument, type ContentBlock, type ContentInline } from '../../app/lib/content/markdown';
import { withI18n } from './trends-i18n-harness';

function render(element: ReactElement): string {
  const router = createMemoryRouter([{ path: '*', element: withI18n(element) }], { initialEntries: ['/terms'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function paragraph(children: ContentInline[]): ContentBlock {
  return { kind: 'paragraph', children };
}

function link(href: string): ContentBlock {
  return paragraph([{ kind: 'link', href, children: [{ kind: 'text', text: 'the link' }] }]);
}

describe('text is drawn as text', () => {
  it('escapes a tag in a text run instead of drawing it', () => {
    const markup = render(createElement(ContentBlocks, { blocks: [paragraph([{ kind: 'text', text: '<script>alert(1)</script>' }])] }));
    assert.ok(markup.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), markup);
    assert.ok(!markup.includes('<script>'), 'a script element was drawn');
  });

  it('CONTROL: a strong run IS drawn as an element, so the check above can tell the two apart', () => {
    const markup = render(
      createElement(ContentBlocks, { blocks: [paragraph([{ kind: 'strong', children: [{ kind: 'text', text: 'bold' }] }])] }),
    );
    assert.ok(markup.includes('<strong>bold</strong>'), markup);
  });

  it('has no path that injects markup in its source', () => {
    const source = readFileSync(fileURLToPath(new URL('../../app/components/content-article.tsx', import.meta.url)), 'utf8');
    // The file's own comment names the prop to say it is absent, so the check reads code, not comments.
    const code = source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /dangerouslySetInnerHTML|innerHTML/);
    // CONTROL: the same check on a line that does inject markup answers yes.
    assert.match('<p dangerouslySetInnerHTML={{ __html: text }} />', /dangerouslySetInnerHTML|innerHTML/);
  });
});

describe('links', () => {
  it('draws an app path through the router, as a plain href on the page', () => {
    const markup = render(createElement(ContentBlocks, { blocks: [link('/imprint')] }));
    assert.match(markup, /<a [^>]*href="\/imprint"[^>]*>the link<\/a>/);
    assert.doesNotMatch(markup, /target="_blank"/);
  });

  it('opens an https link in a new tab with no opener and no referrer', () => {
    const markup = render(createElement(ContentBlocks, { blocks: [link('https://example.org')] }));
    assert.match(markup, /href="https:\/\/example.org"/);
    assert.match(markup, /rel="noopener noreferrer"/);
    assert.match(markup, /target="_blank"/);
  });

  it('draws mailto and tel as plain anchors', () => {
    assert.match(render(createElement(ContentBlocks, { blocks: [link('mailto:someone@example.org')] })), /href="mailto:someone@example.org"/);
    assert.match(render(createElement(ContentBlocks, { blocks: [link('tel:+000')] })), /href="tel:\+000"/);
  });

  for (const target of ['javascript:alert(1)', 'data:text/html,x', '//example.org', 'http://example.org']) {
    it(`draws the text of a ${target.split(':')[0]} link with no anchor at all`, () => {
      const markup = render(createElement(ContentBlocks, { blocks: [link(target)] }));
      assert.doesNotMatch(markup, /<a\b/, markup);
      assert.match(markup, /the link/);
    });
  }
});

describe('blocks', () => {
  it('draws the lead at the lead size and later paragraphs at the body size', () => {
    const blocks: ContentBlock[] = [
      paragraph([{ kind: 'text', text: 'Lead' }]),
      { kind: 'heading', level: 2, children: [{ kind: 'text', text: 'Heading' }] },
      paragraph([{ kind: 'text', text: 'Body' }]),
    ];
    const markup = render(createElement(ContentBlocks, { blocks, hasLead: true }));
    assert.match(markup, /<p class="[^"]*text-lg[^"]*">Lead<\/p>/);
    assert.match(markup, /<p class="leading-7">Body<\/p>/);
    // CONTROL: without a lead, the first paragraph is body-sized too.
    assert.match(render(createElement(ContentBlocks, { blocks })), /<p class="leading-7">Lead<\/p>/);
  });

  it('draws a parsed file with a list, a definition list and a hard break', () => {
    const document = parseContentDocument({
      source: '---\ntitle: T\nupdated: 2026-01-15\n---\n\nLine one\\\nline two\n\n- a\n- b\n\n1. c\n\nTerm\n: Def\n',
      sections: [],
    });
    const markup = render(createElement(ContentBlocks, { blocks: document.body }));
    assert.match(markup, /Line one<br\/>line two/);
    assert.match(markup, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
    assert.match(markup, /<ol><li>c<\/li><\/ol>/);
    assert.match(markup, /<dl><div><dt>Term<\/dt><dd>Def<\/dd><\/div><\/dl>/);
  });
});

describe('the article', () => {
  const props = { title: 'A fixture page', updated: '2026-01-15', language: 'en', blocks: [] };

  it('draws the title as the h1 and the date in the reader’s language, in the prose face', () => {
    const markup = render(createElement(ContentArticle, props));
    assert.match(markup, /<article class="font-prose [^"]*" lang="en">/);
    assert.match(markup, /<h1 [^>]*>A fixture page<\/h1>/);
    assert.match(markup, /Last updated: January 15, 2026/);
  });

  it('leaves the date out where the page asks, as a receipt does', () => {
    const markup = render(createElement(ContentArticle, { ...props, hasUpdatedLine: false }));
    assert.doesNotMatch(markup, /Last updated/);
  });
});
