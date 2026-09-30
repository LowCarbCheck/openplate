/**
 * The moved page's markup (`app/lib/moved/moved-page.tsx`) and the links it borrows from the
 * server build (`app/lib/moved/moved-page-links.ts`).
 *
 * WHAT IS HELD: the document speaks the language it was given, its one button goes to the sign-in
 * page at the new address, it links the app's stylesheets but not the web app manifest, and it
 * carries NO script but the inline theme line. That last one is the load-bearing claim: an app
 * script here would register `/sw.js`, which in moved mode is the kill switch, and reload forever.
 *
 * THE CONTROLS. The script reader is shown a document with a module script and an external one and
 * finds both; the manifest filter is fed a build whose `links()` names the manifest AND an icon,
 * and keeps the icon, so "no manifest" is not a reader that drops every link.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { LinkDescriptor } from 'react-router';

import { movedPageCopy } from '../../app/lib/moved/moved-copy';
import { renderMovedPage } from '../../app/lib/moved/moved-page';
import { readMovedPageLinks, type RootLinkSource } from '../../app/lib/moved/moved-page-links';

/** The root module's links, the shape `app/root.tsx`'s `links` export has, hashes invented. */
const ROOT_LINKS: LinkDescriptor[] = [
  { rel: 'stylesheet', href: '/assets/app-TEST.css' },
  { rel: 'preload', href: '/assets/victor-mono-latin-TEST.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'manifest', href: '/site.webmanifest' },
  { rel: 'icon', href: '/favicon.ico?v=2', sizes: '48x48' },
];

/** A server build as far as the page reads one. */
const FAKE_BUILD: RootLinkSource = {
  assets: { routes: { root: { css: ['/assets/root-TEST.css'] } } },
  routes: { root: { module: { links: () => ROOT_LINKS } } },
};

/** Every `<script>` opening tag in a document. */
function scriptTags(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
}

/** The attribute list of every `<link>` in a document. */
function linkTags(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*>/g)].map((match) => match[0]);
}

/** The moved page in `language`, drawn against the fake build. */
function renderIn(language: 'en' | 'de'): string {
  return renderMovedPage({
    language,
    copy: movedPageCopy({ language, host: 'app.openplate.example' }),
    signInUrl: 'https://app.openplate.example/sign-in',
    links: readMovedPageLinks(FAKE_BUILD),
  });
}

describe('readMovedPageLinks', () => {
  it('reads the root css first, then the root module links, without the manifest', () => {
    assert.deepEqual(
      readMovedPageLinks(FAKE_BUILD).map((link) => `${link.rel} ${link.href}`),
      [
        'stylesheet /assets/root-TEST.css',
        'stylesheet /assets/app-TEST.css',
        'preload /assets/victor-mono-latin-TEST.woff2',
        'icon /favicon.ico?v=2',
      ],
    );
  });

  it('keeps what a font preload needs to be used, not fetched twice', () => {
    const preload = readMovedPageLinks(FAKE_BUILD).find((link) => link.rel === 'preload');
    assert.deepEqual(preload, {
      rel: 'preload',
      href: '/assets/victor-mono-latin-TEST.woff2',
      as: 'font',
      type: 'font/woff2',
      sizes: undefined,
      crossOrigin: 'anonymous',
    });
  });

  it('refuses a build with no root route instead of drawing an unstyled page', () => {
    assert.throws(() => readMovedPageLinks({ assets: { routes: {} }, routes: {} }), /no root route/);
  });
});

describe('the moved page markup', () => {
  it('is a whole document in the language it was given', () => {
    const html = renderIn('de');
    const title = movedPageCopy({ language: 'de', host: 'app.openplate.example' }).title;
    assert.match(html, /^<!DOCTYPE html><html lang="de"/);
    assert.ok(html.includes(`<title>${title}</title>`), 'the German title');
    assert.ok(!html.includes(`<title>${movedPageCopy({ language: 'en', host: 'x' }).title}</title>`), 'not the English one');
  });

  it('sends its one link out to the sign-in page at the new address', () => {
    const hrefs = [...renderIn('en').matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(hrefs, ['https://app.openplate.example/sign-in']);
  });

  it('links the stylesheets and never the manifest', () => {
    const links = linkTags(renderIn('en'));
    assert.ok(links.some((tag) => tag.includes('href="/assets/app-TEST.css"')), links.join('\n'));
    assert.ok(links.some((tag) => tag.includes('href="/assets/root-TEST.css"')), links.join('\n'));
    assert.ok(!links.some((tag) => tag.includes('rel="manifest"')), links.join('\n'));
  });

  it('carries one script, inline, and no app script at all', () => {
    const scripts = scriptTags(renderIn('en'));
    assert.deepEqual(scripts, ['<script>']);
    assert.doesNotMatch(renderIn('en'), /modulepreload/);
  });

  it('control: the script reader finds a module script and an external one', () => {
    const appLike = '<head><script type="module">import "/assets/entry.js"</script><script src="/assets/x.js"></script></head>';
    assert.deepEqual(scriptTags(appLike), ['<script type="module">', '<script src="/assets/x.js">']);
  });
});
