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

import { foreignLinkOrigin, inviteBodyKey } from '../../app/lib/admin/link-delivery';

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
    link: z.object({ otherAddress: z.string() }),
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
});
