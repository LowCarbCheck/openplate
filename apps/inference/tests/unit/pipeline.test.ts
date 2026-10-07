/**
 * The pure pieces: config parsing, the image-intake helpers, the downscale
 * arithmetic, and the terse → contract mapping. No sockets, no model.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { parseApiKeys, parseConfig } from '../../src/config.js';
import {
  ALLOWED_IMAGE_FORMATS,
  BLOCKED_LOADER_OPERATIONS,
  PATCH_ALIGNMENT,
  decodeImageDataUri,
  extractImageDataUri,
  jsonBodyLimitBytes,
  prepareImage,
  targetDimensions,
} from '../../src/pipeline/image.js';
import { formatPortionHint, mapTerseToPlate } from '../../src/pipeline/map-terse.js';
import {
  MAX_TERSE_ITEMS,
  TERSE_CANDIDATE_JSON_SCHEMA,
  TERSE_SYSTEM_PROMPT,
  buildTerseMessages,
} from '../../src/pipeline/terse-contract.js';
import { parseTerseContent } from '../../src/pipeline/runtime-client.js';
import { makeJpeg, toDataUri } from '../support/app-harness.js';

describe('config', () => {
  it('requires MODEL_RUNTIME_URL', () => {
    expect(() => parseConfig({})).toThrow(/MODEL_RUNTIME_URL/);
  });

  it('applies the documented defaults', () => {
    const config = parseConfig({ MODEL_RUNTIME_URL: 'http://127.0.0.1:8080' });
    expect(config.port).toBe(8300);
    expect(config.concurrency).toBe(2);
    // 0 = disabled, the self-host default. Flipping this default would silently
    // make every slow CPU box shed its own traffic.
    expect(config.latencyCeilingMs).toBe(0);
    expect(config.maxImageBytes).toBe(8 * 1024 * 1024);
    expect(config.rateLimitRpm).toBe(60);
    expect(config.imageMaxLongEdge).toBe(896);
    expect(config.profile).toBe('custom');
    expect(config.apiKeys).toEqual([]);
  });

  it('treats a blank value as unset rather than zero', () => {
    // `CONCURRENCY=` in a .env file must not configure a pool that can never run.
    const config = parseConfig({ MODEL_RUNTIME_URL: 'http://x:1', CONCURRENCY: '   ' });
    expect(config.concurrency).toBe(2);
  });

  it('normalizes a runtime URL that already carries /v1', () => {
    expect(parseConfig({ MODEL_RUNTIME_URL: 'http://host:8080/v1/' }).modelRuntimeUrl).toBe('http://host:8080');
  });

  it('rejects a non-http runtime URL and a bad log level', () => {
    expect(() => parseConfig({ MODEL_RUNTIME_URL: 'host:8080' })).toThrow(/http/);
    expect(() => parseConfig({ MODEL_RUNTIME_URL: 'http://x:1', LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/);
  });

  it('splits and de-duplicates API_KEYS', () => {
    expect(parseApiKeys(' a , b ,,a ')).toEqual(['a', 'b']);
  });
});

describe('terse contract', () => {
  it('bounds the item count in the grammar, which is what bounds decode', () => {
    expect(TERSE_CANDIDATE_JSON_SCHEMA.properties?.f?.maxItems).toBe(MAX_TERSE_ITEMS);
    expect(TERSE_CANDIDATE_JSON_SCHEMA.properties?.f?.minItems).toBe(0);
    expect(TERSE_CANDIDATE_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it('carries no background flag (it never fired across 192 benchmarked items)', () => {
    const itemProperties = TERSE_CANDIDATE_JSON_SCHEMA.properties?.f?.items?.properties ?? {};
    expect(Object.keys(itemProperties)).toEqual(['n', 'g']);
  });

  it('asks for sauces and dressings as separate items', () => {
    expect(TERSE_SYSTEM_PROMPT).toContain('sauces and dressings as separate items');
  });

  it('still carries the background-exclusion rule in the prompt', () => {
    expect(TERSE_SYSTEM_PROMPT).toContain('menus, posters, signs, screens');
  });

  it('puts the image before the instruction', () => {
    const [system, user] = buildTerseMessages('data:image/jpeg;base64,AAAA');
    expect(system.role).toBe('system');
    const parts = Array.isArray(user.content) ? user.content : [];
    expect(parts.map((part) => part.type)).toEqual(['image_url', 'text']);
  });

  it('parses a terse reply and rejects the production shape', () => {
    expect(parseTerseContent('{"f":[{"n":"rice","g":180}]}').f[0].g).toBe(180);
    expect(() => parseTerseContent('{"foods":[]}')).toThrow(/did not match/);
    expect(() => parseTerseContent('not json')).toThrow(/not valid JSON/);
  });
});

describe('image intake', () => {
  it('derives the JSON body limit from MAX_IMAGE_BYTES with room for base64 inflation', () => {
    // A limit set AT the raw cap would reject a legitimate maximum-size photo.
    expect(jsonBodyLimitBytes(3_000)).toBeGreaterThan(3_000 * (4 / 3));
  });

  it('finds the image regardless of content-part order', () => {
    const uri = 'data:image/png;base64,AAAA';
    expect(
      extractImageDataUri([
        { role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: uri } }] },
      ]),
    ).toBe(uri);
    expect(
      extractImageDataUri([
        { role: 'user', content: [{ type: 'image_url', image_url: { url: uri } }, { type: 'text', text: 'hi' }] },
      ]),
    ).toBe(uri);
  });

  it('rejects a non-array messages field', () => {
    expect(() => extractImageDataUri('a plate photo')).toThrow(/messages/);
  });

  it('enforces the byte cap on the DECODED payload, not the base64', () => {
    // 12 bytes of base64 encode 9 bytes; a cap applied to the string would be
    // wrong by a third.
    const uri = `data:image/jpeg;base64,${Buffer.alloc(9, 1).toString('base64')}`;
    expect(() => decodeImageDataUri(uri, 8)).toThrow(/9 bytes/);
    expect(decodeImageDataUri(uri, 9).bytes.byteLength).toBe(9);
  });

  it('rejects an empty payload', () => {
    expect(() => decodeImageDataUri('data:image/jpeg;base64,', 100)).toThrow();
  });

  it('snaps both dimensions to whole 112 px patches', () => {
    const target = targetDimensions(1280, 960, 896);
    expect(target.width % PATCH_ALIGNMENT).toBe(0);
    expect(target.height % PATCH_ALIGNMENT).toBe(0);
    expect(target.width).toBe(896);
    // 960 × (896/1280) = 672 = 6 × 112, exactly.
    expect(target.height).toBe(672);
  });

  it('never snaps a dimension to zero', () => {
    expect(targetDimensions(4000, 40, 896).height).toBe(PATCH_ALIGNMENT);
  });

  it('downscales an oversized photo to the cap and re-encodes as JPEG', async () => {
    const original = toDataUri(await makeJpeg(1600, 1200));
    const prepared = await prepareImage(original, { maxImageBytes: 10_000_000, maxLongEdge: 896 });

    expect(prepared.downscaled).toBe(true);
    expect(prepared.mimeType).toBe('image/jpeg');
    expect(Math.max(prepared.width, prepared.height)).toBe(896);
    expect(prepared.preparedBytes).toBeLessThan(prepared.originalBytes);

    const metadata = await sharp(Buffer.from(prepared.dataUri.split(',')[1], 'base64')).metadata();
    expect(metadata.width).toBe(896);
    expect(metadata.height).toBe(672);
  });

  it('passes an already-small photo through untouched', async () => {
    const original = toDataUri(await makeJpeg(640, 480));
    const prepared = await prepareImage(original, { maxImageBytes: 10_000_000, maxLongEdge: 896 });
    expect(prepared.downscaled).toBe(false);
    expect(prepared.dataUri).toBe(original);
  });

  it('rejects a payload that is not a decodable image as a 400, not a 500', async () => {
    const junk = `data:image/jpeg;base64,${Buffer.from('this is not a jpeg at all').toString('base64')}`;
    await expect(prepareImage(junk, { maxImageBytes: 1_000_000, maxLongEdge: 896 })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('image format allow list', () => {
  const svgBytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
  );
  const limits = { maxImageBytes: 1_000_000, maxLongEdge: 896 };

  it('accepts a small valid PNG', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer();
    const dataUri = `data:image/png;base64,${png.toString('base64')}`;
    const prepared = await prepareImage(dataUri, limits);
    expect(prepared.width).toBe(8);
    expect(prepared.dataUri).toBe(dataUri);
  });

  it('rejects an SVG document with the same 400 as a corrupt image, whatever MIME it declares', async () => {
    for (const mime of ['image/svg+xml', 'image/png']) {
      const dataUri = `data:${mime};base64,${svgBytes.toString('base64')}`;
      await expect(prepareImage(dataUri, limits)).rejects.toMatchObject({
        status: 400,
        code: 'unsupported_image_source',
      });
    }
  });

  it('control: the loader block is active, so sharp refuses the SVG before any parse', async () => {
    // sharp's message here is the generic "unsupported image format", it does not
    // name the operation, so the assertion is that the call rejects at all. The
    // unblock test below shows the same call succeeds without the block.
    await expect(sharp(svgBytes).metadata()).rejects.toThrow();
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00ff00' } })
      .png()
      .toBuffer();
    await expect(sharp(png).metadata()).resolves.toMatchObject({ format: 'png', width: 4 });
  });

  it('control: without the block, sharp WOULD decode that SVG', async () => {
    sharp.unblock({ operation: ['VipsForeignLoadSvg'] });
    try {
      const metadata = await sharp(svgBytes).metadata();
      expect(metadata.format).toBe('svg');
      expect(metadata.width).toBe(8);
    } finally {
      sharp.block({ operation: [...BLOCKED_LOADER_OPERATIONS] });
    }
  });

  it('the per-call format check rejects an SVG on its own when the block is lifted', async () => {
    sharp.unblock({ operation: ['VipsForeignLoadSvg'] });
    try {
      expect(ALLOWED_IMAGE_FORMATS.has('svg')).toBe(false);
      const dataUri = `data:image/png;base64,${svgBytes.toString('base64')}`;
      await expect(prepareImage(dataUri, limits)).rejects.toMatchObject({
        status: 400,
        code: 'unsupported_image_source',
      });
    } finally {
      sharp.block({ operation: [...BLOCKED_LOADER_OPERATIONS] });
    }
  });

  it('control: the blocked non-photo loaders refuse TIFF and GIF, and the allowed ones still decode', async () => {
    const blank = { create: { width: 4, height: 4, channels: 3 as const, background: '#ff0000' } };
    for (const bytes of [await sharp(blank).tiff().toBuffer(), await sharp(blank).gif().toBuffer()]) {
      await expect(sharp(bytes).metadata()).rejects.toThrow();
    }
    for (const bytes of [await sharp(blank).jpeg().toBuffer(), await sharp(blank).webp().toBuffer()]) {
      await expect(sharp(bytes).metadata()).resolves.toBeDefined();
    }
  });

  it('blocks the SVG and PDF loaders and none of the allowed formats', () => {
    expect(BLOCKED_LOADER_OPERATIONS).toContain('VipsForeignLoadSvg');
    expect(BLOCKED_LOADER_OPERATIONS).toContain('VipsForeignLoadPdf');
    for (const format of ALLOWED_IMAGE_FORMATS) {
      expect(BLOCKED_LOADER_OPERATIONS.join(' ').toLowerCase()).not.toContain(format);
    }
  });

  it('control: the allow list holds the formats the error message promises', () => {
    expect([...ALLOWED_IMAGE_FORMATS].toSorted()).toEqual(['jpeg', 'png', 'webp']);
  });
});

describe('terse → PlateIdentification mapping', () => {
  it('renders the portion hint from the grams the model gave', () => {
    expect(formatPortionHint(140.4)).toBe('about 140 g');
    expect(formatPortionHint(0)).toBeNull();
    expect(formatPortionHint(Number.NaN)).toBeNull();
  });

  it('drops zero-gram and blank items instead of logging a phantom food', () => {
    const { plate, duplicatesDropped } = mapTerseToPlate({
      f: [
        { n: 'rice', g: 180 },
        { n: '   ', g: 50 },
        { n: 'salt', g: 0 },
        { n: 'sauce', g: -3 },
      ],
    });
    expect(plate.foods.map((food) => food.name)).toEqual(['rice']);
    expect(duplicatesDropped).toBe(3);
  });

  it('trims names and dedupes case- and whitespace-insensitively', () => {
    const { plate, duplicatesDropped } = mapTerseToPlate({
      f: [
        { n: '  Green   Salad ', g: 90 },
        { n: 'green salad', g: 70 },
      ],
    });
    expect(plate.foods).toHaveLength(1);
    expect(plate.foods[0].name).toBe('Green   Salad');
    expect(duplicatesDropped).toBe(1);
  });

  it('emits null macros and null notes for every item, always', () => {
    const { plate } = mapTerseToPlate({ f: [{ n: 'a', g: 1 }, { n: 'b', g: 2 }] });
    expect(plate.notes).toBeNull();
    expect(plate.foods.every((food) => food.macrosPer100g === null)).toBe(true);
  });
});
