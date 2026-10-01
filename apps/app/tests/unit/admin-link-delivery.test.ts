/**
 * How a link reaches a person: which address a hand-passed link opens, and
 * which sentence the invite form says before anything is sent.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The compose files default the core's link bases to `http://localhost:3000`
 * and `http://localhost:3001`. An operator who did not set PUBLIC_APP_URL got an
 * admin screen that handed them `http://localhost:3000/join#...` to pass on,
 * and nothing on the screen said that link opens only on the server. The admin
 * is looking at the app through the address the family uses, so comparing the
 * link's origin with the page's origin is the check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { foreignLinkOrigin, inviteBodyKey, linkWarning } from '../../app/lib/admin/link-delivery';

const LOCALHOST_LINK = 'http://localhost:3000/join#server=http%3A%2F%2Flocalhost%3A3001&invite=si_abc';

test('a link on another origin than the page names the origin it opens', () => {
  assert.equal(foreignLinkOrigin({ link: LOCALHOST_LINK, pageOrigin: 'http://bluefin:3000' }), 'http://localhost:3000');
  // The port is part of the origin: the same host on another port is another app.
  assert.equal(
    foreignLinkOrigin({
      link: 'https://openplate.example.org:8443/reset#token=sr_x',
      pageOrigin: 'https://openplate.example.org',
    }),
    'https://openplate.example.org:8443',
  );
  // So is the scheme.
  assert.equal(
    foreignLinkOrigin({
      link: 'http://openplate.example.org/join#invite=si_x',
      pageOrigin: 'https://openplate.example.org',
    }),
    'http://openplate.example.org',
  );
});

test('CONTROL: a link on the page origin names nothing', () => {
  assert.equal(foreignLinkOrigin({ link: LOCALHOST_LINK, pageOrigin: 'http://localhost:3000' }), null);
  assert.equal(
    foreignLinkOrigin({
      link: 'https://openplate.example.org/join#server=https%3A%2F%2Fsync.example.org&invite=si_x',
      pageOrigin: 'https://openplate.example.org',
    }),
    null,
  );
  // The default port is the same origin written two ways; the parser folds it.
  assert.equal(
    foreignLinkOrigin({
      link: 'https://openplate.example.org:443/join#invite=si_x',
      pageOrigin: 'https://openplate.example.org',
    }),
    null,
  );
  // Host names are case-insensitive.
  assert.equal(
    foreignLinkOrigin({
      link: 'https://OpenPlate.Example.org/join#invite=si_x',
      pageOrigin: 'https://openplate.example.org',
    }),
    null,
  );
});

test('before hydration there is no page origin, so nothing is named and the server markup stays the same', () => {
  assert.equal(foreignLinkOrigin({ link: LOCALHOST_LINK, pageOrigin: null }), null);
});

test('a link that does not parse names nothing rather than throwing on the admin screen', () => {
  // The core only ever sends absolute links; a broken one is shown as it came,
  // and a wrong warning under it would add a second puzzle.
  assert.equal(foreignLinkOrigin({ link: 'not a link', pageOrigin: 'http://bluefin:3000' }), null);
  assert.equal(foreignLinkOrigin({ link: '', pageOrigin: 'http://bluefin:3000' }), null);
});

// ── The server= half of the link ──────────────────────────────────────────
//
// A link whose app address is right can still name a core server the reader's
// device cannot reach: `server=http%3A%2F%2Flocalhost%3A3001` opens the right
// page and then points the app at the reader's own phone. The page the family
// uses is https on a real host (the app signs nobody in anywhere else), so a
// loopback or plain-http server beside it is the defect.

/** The address a family opens the app at, in these cases. */
const FAMILY_APP = 'https://openplate.family.example';

/** A join link on the family's own app address, naming `server`. */
function familyLink(server: string): string {
  return `${FAMILY_APP}/join#server=${encodeURIComponent(server)}&invite=si_abc`;
}

test('a link on the right app address whose server= names this machine or plain http warns about the core server', () => {
  for (const server of [
    'http://localhost:3001',
    'https://localhost:3001',
    'http://127.0.0.1:3001',
    'https://127.0.1.1',
    'http://[::1]:3001',
    'https://sync.localhost',
    // A real host, but plain http: an https page cannot call it.
    'http://sync.family.example',
  ]) {
    assert.deepEqual(
      linkWarning({ link: familyLink(server), pageOrigin: FAMILY_APP }),
      { kind: 'unreachable-server', server: new URL(server).origin },
      server,
    );
  }
  // A reset link carries its server= the same way.
  assert.deepEqual(
    linkWarning({
      link: `${FAMILY_APP}/reset#server=${encodeURIComponent('http://localhost:3001')}&token=sr_x`,
      pageOrigin: FAMILY_APP,
    }),
    { kind: 'unreachable-server', server: 'http://localhost:3001' },
  );
});

test('CONTROL: a link on the right app address with an https core server on a real host warns about nothing', () => {
  for (const server of ['https://sync.family.example', 'https://openplate.family.example', 'https://100.64.0.3:8443']) {
    assert.equal(linkWarning({ link: familyLink(server), pageOrigin: FAMILY_APP }), null, server);
  }
});

test('CONTROL: on this machine, a link to this machine is consistent and warns about nothing', () => {
  // The dev setup and the ssh-tunnel test: the page, the app and the core server
  // are all on this machine, where plain http is a secure page. The link works
  // exactly where the administrator is, and the app address check already
  // covers the case where the page is somewhere else.
  const link = 'http://localhost:3000/join#server=http%3A%2F%2Flocalhost%3A3001&invite=si_abc';
  assert.equal(linkWarning({ link, pageOrigin: 'http://localhost:3000' }), null);
});

test('a link on another app address names that address, and the server= half is covered by the same line', () => {
  assert.deepEqual(
    linkWarning({
      link: 'http://localhost:3000/join#server=http%3A%2F%2Flocalhost%3A3001&invite=si_abc',
      pageOrigin: FAMILY_APP,
    }),
    { kind: 'other-origin', origin: 'http://localhost:3000' },
  );
});

test('a link with no server= or an unreadable one, and a page not hydrated yet, warn about nothing', () => {
  assert.equal(linkWarning({ link: `${FAMILY_APP}/join#invite=si_abc`, pageOrigin: FAMILY_APP }), null);
  assert.equal(
    linkWarning({ link: `${FAMILY_APP}/join#server=not%20a%20url&invite=si_abc`, pageOrigin: FAMILY_APP }),
    null,
  );
  assert.equal(linkWarning({ link: familyLink('http://localhost:3001'), pageOrigin: null }), null);
});

test('the invite form says the mail sentence only where the instance says it sends mail', () => {
  assert.equal(inviteBodyKey({ mail: true }), 'admin.invite.body');
  assert.equal(inviteBodyKey({ mail: false }), 'admin.invite.bodyNoMail');
  // An unreachable handshake is "not known", never a licence to pick one.
  assert.equal(inviteBodyKey({ mail: null }), 'admin.invite.bodyUnknown');
});

/** The three invite sentences, as the English catalog holds them. */
const inviteCopySchema = z.object({
  admin: z.object({
    invite: z.object({ body: z.string(), bodyNoMail: z.string(), bodyUnknown: z.string() }),
    link: z.object({ otherAddress: z.string(), syncAddress: z.string() }),
  }),
});

test('every sentence the form can pick is a different sentence in the English catalog', () => {
  const url = new URL('../../app/i18n/locales/en/common.json', import.meta.url);
  const catalog = inviteCopySchema.parse(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
  const sentences = new Set([
    catalog.admin.invite.body,
    catalog.admin.invite.bodyNoMail,
    catalog.admin.invite.bodyUnknown,
  ]);
  assert.equal(sentences.size, 3, 'three cases, three sentences');
  // The warning names the address it found and the two settings that fix it.
  assert.match(catalog.admin.link.otherAddress, /\{\{origin\}\}/);
  assert.match(catalog.admin.link.otherAddress, /PUBLIC_APP_URL/);
  assert.match(catalog.admin.link.otherAddress, /PUBLIC_SYNC_URL/);
  // The core server line names the address it found and the one setting that fixes it.
  assert.match(catalog.admin.link.syncAddress, /\{\{server\}\}/);
  assert.match(catalog.admin.link.syncAddress, /PUBLIC_SYNC_URL/);
});
