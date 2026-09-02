/**
 * The readable handle suggestion, and the vocabulary it draws from.
 *
 * THE CLAIM THIS FILE DEFENDS: every value `suggestHandle` can produce is a
 * handle the service will accept, in the language the user is reading, and
 * assembled from words nobody has to apologise for. The lists are generated
 * data (`handle-words.{en,de}.ts` — English by hand, German by wordsmith),
 * which is exactly why their hygiene is re-asserted here rather than trusted:
 * a later hand-added entry with an umlaut, a hyphen, or eleven letters is a
 * broken handle on someone's account card, and it would otherwise ship.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DE_HANDLE_ADJECTIVES, DE_HANDLE_ANIMALS } from '../../app/lib/sync/handle-words.de';
import { EN_HANDLE_ADJECTIVES, EN_HANDLE_ANIMALS } from '../../app/lib/sync/handle-words.en';
import {
  findHandleProblem,
  HANDLE_NUMBER_MIN,
  MAX_HANDLE_LENGTH,
  resolveHandleWords,
  suggestHandle,
} from '../../app/lib/sync/handle';

/** The exact shape the owner specified: two words, then two digits with no leading zero. */
const SUGGESTION = /^[a-z]{3,10}-[a-z]{3,10}-[1-9][0-9]$/;

const DRAWS = 1000;

/**
 * A random source every draw must reject: every byte high means every 32-bit
 * value it can produce sits outside the largest whole multiple of any bound
 * `suggestHandle` uses.
 */
const stuckRandomBytes = (length: number): Uint8Array => new Uint8Array(length).fill(0xff);

/**
 * A handful of words that must never reach a list.
 *
 * A GUARD, not a filter: it cannot prove a list is inoffensive, and it is not
 * meant to. It catches the one failure mode that is otherwise silent — a
 * regenerated German list, or a hand-added English entry, quietly introducing
 * a word the owner would not put on an account card.
 */
const DENIED = [
  'angry',
  'bitter',
  'blind',
  'blutfink',
  'blutig',
  'braun',
  'crazy',
  'cruel',
  'dead',
  'doof',
  'drunk',
  'dumb',
  'dumm',
  'fascist',
  'fat',
  'fett',
  'filthy',
  'giftig',
  'hass',
  'hate',
  'kill',
  'krank',
  'krieg',
  'nasty',
  'nazi',
  'scharf',
  'sex',
  'sick',
  'stupid',
  'sucht',
  'toxic',
  'toxisch',
  'ugly',
  'vile',
  'war',
];

/**
 * The fifteen animals that must survive any regeneration of these lists.
 *
 * THE ANCHOR IS THE POINT. Every other assertion in this file is mechanical —
 * ASCII, length, no duplicates — and a list of obscure fauna passes all of
 * them. `quick-guillemot-42` is a valid handle and a bad suggestion. Losing
 * `otter` or `igel` is what a drift back towards obscure species looks like
 * from here, so the anchors fail before the shape does.
 */
const ANCHORS = {
  english: [
    'otter',
    'wombat',
    'fox',
    'hedgehog',
    'panda',
    'koala',
    'penguin',
    'owl',
    'seal',
    'dolphin',
    'llama',
    'sloth',
    'rabbit',
    'cat',
    'dog',
  ],
  german: [
    'otter',
    'wombat',
    'fuchs',
    'igel',
    'panda',
    'koala',
    'pinguin',
    'eule',
    'robbe',
    'delfin',
    'lama',
    'faultier',
    'hase',
    'katze',
    'hund',
  ],
};

const LISTS = [
  { name: 'English adjectives', words: EN_HANDLE_ADJECTIVES },
  { name: 'English animals', words: EN_HANDLE_ANIMALS },
  { name: 'German adjectives', words: DE_HANDLE_ADJECTIVES },
  { name: 'German animals', words: DE_HANDLE_ANIMALS },
];

describe('handle word lists', () => {
  for (const { name, words } of LISTS) {
    it(`${name}: every entry is lowercase ASCII letters only`, () => {
      for (const word of words) {
        assert.match(word, /^[a-z]+$/, `"${word}" in ${name} is not lowercase ASCII letters`);
      }
    });

    it(`${name}: every entry is 3 to 10 letters`, () => {
      for (const word of words) {
        assert.ok(word.length >= 3 && word.length <= 10, `"${word}" in ${name} is ${word.length} letters`);
      }
    });

    it(`${name}: has no duplicates`, () => {
      assert.equal(new Set(words).size, words.length, `${name} contains a duplicate`);
    });

    it(`${name}: has at least 90 entries`, () => {
      assert.ok(words.length >= 90, `${name} has only ${words.length} entries`);
    });

    it(`${name}: contains no denied word`, () => {
      for (const denied of DENIED) {
        assert.ok(!words.includes(denied), `"${denied}" must not appear in ${name}`);
      }
    });
  }
});

describe('animal lists stay recognisable', () => {
  const ANIMAL_LISTS = [
    { name: 'English animals', words: EN_HANDLE_ANIMALS, anchors: ANCHORS.english },
    { name: 'German animals', words: DE_HANDLE_ANIMALS, anchors: ANCHORS.german },
  ];

  for (const { name, words, anchors } of ANIMAL_LISTS) {
    // A hard ceiling below the adjectives'. An animal a child names is a short
    // word; needing ten letters is itself the signal that a species has crept
    // in (`guillemot`, `sitatunga`, `hartebeest`).
    it(`${name}: every entry is at most 9 letters`, () => {
      for (const word of words) {
        assert.ok(
          word.length <= 9,
          `"${word}" in ${name} is ${word.length} letters, so it is probably not an everyday animal`,
        );
      }
    });

    it(`${name}: still contains all 15 anchor animals`, () => {
      for (const anchor of anchors) {
        assert.ok(words.includes(anchor), `${name} has lost the anchor "${anchor}"`);
      }
    });
  }
});

describe('suggestHandle', () => {
  for (const language of ['en', 'de']) {
    it(`emits the adjective-animal-number shape in "${language}", over ${DRAWS} draws`, () => {
      for (let draw = 0; draw < DRAWS; draw += 1) {
        const suggestion = suggestHandle(language);
        assert.match(suggestion, SUGGESTION, `"${suggestion}" is not a readable handle`);
      }
    });

    it(`draws only from the "${language}" lists, over ${DRAWS} draws`, () => {
      const { adjectives, animals } = resolveHandleWords(language);
      for (let draw = 0; draw < DRAWS; draw += 1) {
        const [adjective, animal] = suggestHandle(language).split('-');
        assert.ok(adjectives.includes(adjective), `"${adjective}" is not in the ${language} adjective list`);
        assert.ok(animals.includes(animal), `"${animal}" is not in the ${language} animal list`);
      }
    });

    it(`always produces a handle the service accepts, in "${language}"`, () => {
      for (let draw = 0; draw < DRAWS; draw += 1) {
        const suggestion = suggestHandle(language);
        assert.equal(findHandleProblem(suggestion), null, `"${suggestion}" would be refused`);
        assert.ok(suggestion.length <= MAX_HANDLE_LENGTH);
      }
    });
  }

  it('keeps the number in 10..99, over many draws', () => {
    const seen = new Set<number>();
    for (let draw = 0; draw < DRAWS * 5; draw += 1) {
      const tail = suggestHandle('en').split('-')[2];
      const value = Number(tail);
      assert.ok(Number.isInteger(value), `"${tail}" is not an integer`);
      assert.ok(value >= 10 && value <= 99, `${value} is outside 10..99`);
      seen.add(value);
    }
    // Every one of the 90 values must actually be reachable — a bound that is
    // never hit is how an off-by-one in the range survives a range assertion.
    assert.equal(seen.size, 90, `only ${seen.size} of the 90 possible numbers were drawn`);
    assert.equal(Math.min(...seen), HANDLE_NUMBER_MIN);
  });

  it('is German for every German tag, and English for anything unknown', () => {
    for (const tag of ['de', 'de-DE', 'de-AT', 'DE']) {
      assert.equal(resolveHandleWords(tag).adjectives, DE_HANDLE_ADJECTIVES, `"${tag}" should resolve to German`);
    }
    for (const tag of ['en', 'en-GB', 'fr', 'zz-ZZ', '', 'klingon']) {
      assert.equal(resolveHandleWords(tag).adjectives, EN_HANDLE_ADJECTIVES, `"${tag}" should fall back to English`);
    }
  });

  it('rejects a random source that cannot produce an in-range draw', () => {
    // The bounded loop must give up rather than spin.
    assert.throws(() => suggestHandle('en', stuckRandomBytes), /unbiased/);
  });
});
