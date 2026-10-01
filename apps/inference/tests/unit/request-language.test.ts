/**
 * `requestLanguage`: an `Accept-Language` header to the one app language that
 * makes the pipeline translate, or `null` for "make no translation call".
 *
 * The table holds both kinds of row on purpose. A parser that always returned
 * `null` would pass every `null` row, and one that always returned the first
 * tag would pass most of the others; each half is the control for the other.
 */
import { describe, expect, it } from 'vitest';
import type { AppLanguage } from '../../src/contract/plate-identification.js';
import { requestLanguage } from '../../src/server/request-language.js';

describe('requestLanguage', () => {
  it.each<[string | undefined, AppLanguage | null]>([
    // The rows the task names.
    ['de-DE,de;q=0.9,en;q=0.8', 'de'],
    ['en-US', null],
    ['fr;q=0.5, es;q=0.9', 'es'],
    ['*', null],
    ['xx', null],
    [undefined, null],
    ['tr', 'tr'],
    // Weights decide, not order.
    ['en;q=0.4, it;q=0.6', 'it'],
    ['de;q=0.5, en', null],
    // Case and regions.
    ['FR-ca', 'fr'],
    ['ES', 'es'],
    // An unknown tag with a higher weight does not hide a known one.
    ['xx;q=1, de;q=0.3', 'de'],
    ['*;q=1, tr;q=0.2', 'tr'],
    // `q=0` means "not acceptable", and a malformed weight is not a weight.
    ['de;q=0', null],
    ['de;q=0, fr;q=0.1', 'fr'],
    ['de;q=2', null],
    ['de;q=abc, it;q=0.2', 'it'],
    // Equal weights keep the order the client wrote.
    ['it, es', 'it'],
    ['es;q=0.8, it;q=0.8', 'es'],
    // Empty and junk.
    ['', null],
    [' , ;q=0.5', null],
  ])('reads %j as %j', (header, expected) => {
    expect(requestLanguage(header)).toBe(expected);
  });
});
