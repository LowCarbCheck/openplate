/**
 * Image intake: pull the one image out of an OpenAI chat-completions request,
 * decode it, and downscale it before it ever reaches the model.
 *
 * PRIVACY BOUNDARY. This module is the only place raw photo bytes exist, and
 * they live in a `Buffer` that goes out of scope when the request ends. Nothing
 * here writes a file, and nothing here is handed to the logger — `fs` is not
 * imported on purpose, so the next person to add a "just dump it to /tmp to
 * debug" line has to add the import and notice what they are doing.
 *
 * WHY DOWNSCALE AT ALL. Prefill is 40–100 s of a CPU run and image tokens scale
 * with pixel count, so the long-edge cap is the single biggest latency lever
 * available on the client side. 896 px is the benchmarked setting: 72.8 % recall
 * with 0 hallucinations on the 50-image gold set, ~0.49× the image tokens of a
 * 1280 px original (eval, 2026-08-13).
 *
 * The alignment-to-112 arithmetic is ported from
 * `eval/harness/providers.py#_downscale_to_jpeg` — 112 = lcm(16, 28) is an exact
 * patch boundary for both LFM2.5-VL (16 px) and Qwen3-VL (14 px, 2×2 merged),
 * so the vision tower never pads a partial patch.
 */
import sharp from 'sharp';
import { z } from 'zod';
import { badRequest, payloadTooLarge } from '../errors.js';
import { JsonValueSchema, type JsonValue } from '../json.js';

/** See the module header: 112 = lcm(16, 28). */
export const PATCH_ALIGNMENT = 112;

const JPEG_QUALITY = 85;

/** base64 inflates by 4/3; a data URI adds a small prefix on top. */
const BASE64_INFLATION = 4 / 3;

const DATA_URI_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/;

export interface DecodedImage {
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

/** What a data URI carries: the encoded bytes and the media type it declares. */
export interface ImagePayload {
  bytes: Buffer;
  mimeType: string;
}

/** A patch-aligned pixel size. */
export interface PixelDimensions {
  width: number;
  height: number;
}

/** What the runtime is actually sent, plus the metadata worth logging (sizes only). */
export interface PreparedImage {
  dataUri: string;
  mimeType: string;
  originalBytes: number;
  preparedBytes: number;
  width: number;
  height: number;
  downscaled: boolean;
}

/**
 * Body limit for the JSON parser, derived from `MAX_IMAGE_BYTES` rather than
 * chosen: a limit set at the raw cap would reject a legitimate maximum-size
 * photo before any handler saw it, because the base64 in the JSON body is 4/3 the
 * size of the bytes it encodes. The 64 KB slack covers the prompt, the envelope
 * and the data-URI prefix.
 */
export function jsonBodyLimitBytes(maxImageBytes: number): number {
  return Math.ceil(maxImageBytes * BASE64_INFLATION) + 64 * 1024;
}

/**
 * The request's `messages`, decoded only as far as this module needs.
 *
 * Deliberately layered rather than one strict schema: a caller's messages carry
 * a system prompt, text parts and fields we ignore on purpose (see
 * `server/chat-completions.ts`), so a strict parse would reject valid requests.
 * Each schema below answers exactly one question, in the order the errors are
 * reported: is this a message list, does this message have content parts, is
 * this part claiming to be an image, and does that claim hold up.
 */
const MessageListSchema = z.array(JsonValueSchema);
const PartsMessageSchema = z.looseObject({ content: z.array(JsonValueSchema) });
const ImageUrlPartSchema = z.looseObject({ type: z.literal('image_url') });
const UsableImageUrlPartSchema = z.looseObject({
  image_url: z.looseObject({ url: z.string().min(1) }),
});

/**
 * Extracts the single image data URI from the request's messages.
 *
 * Rejects, with a message a client author can act on:
 *  - zero images — this endpoint identifies a plate photo, there is nothing else to do
 *  - more than one image — pipeline v3 is single-plate; merging two photos into
 *    one food log would silently produce a wrong diary entry
 *  - an `http(s)` URL — server-side fetching is a deliberate non-feature for now:
 *    it turns this service into an SSRF-capable fetcher and puts an unbounded
 *    third-party download on the latency budget. Clients send data URIs already
 *    (openplate's adapter builds one from the local file).
 */
export function extractImageDataUri(messages: JsonValue): string {
  const messageList = MessageListSchema.safeParse(messages);
  if (!messageList.success) {
    throw badRequest('`messages` must be an array of chat messages.', { param: 'messages' });
  }

  const urls: string[] = [];
  for (const message of messageList.data) {
    const withParts = PartsMessageSchema.safeParse(message);
    if (!withParts.success) continue;
    for (const part of withParts.data.content) {
      if (!ImageUrlPartSchema.safeParse(part).success) continue;
      // An image part that names itself and then carries nothing usable is a
      // client bug worth reporting, not a part to skip past.
      const usable = UsableImageUrlPartSchema.safeParse(part);
      if (!usable.success) {
        throw badRequest('An `image_url` content part must carry a non-empty `url`.', {
          param: 'messages',
        });
      }
      urls.push(usable.data.image_url.url);
    }
  }

  if (urls.length === 0) {
    throw badRequest(
      'No image found. Send exactly one `image_url` content part containing a base64 data URI.',
      { param: 'messages', code: 'image_missing' },
    );
  }
  if (urls.length > 1) {
    throw badRequest(
      `Exactly one image per request is supported; received ${urls.length}. This endpoint identifies one plate.`,
      { param: 'messages', code: 'too_many_images' },
    );
  }

  const url = urls[0];
  if (/^https?:\/\//i.test(url)) {
    throw badRequest(
      'Remote image URLs are not supported. Inline the image as a base64 data URI (data:image/jpeg;base64,...).',
      { param: 'messages', code: 'unsupported_image_source' },
    );
  }
  if (!DATA_URI_PATTERN.test(url)) {
    throw badRequest(
      'The `image_url.url` must be a base64 image data URI (data:image/jpeg;base64,...).',
      { param: 'messages', code: 'unsupported_image_source' },
    );
  }
  return url;
}

/** Decodes a data URI to bytes and enforces `MAX_IMAGE_BYTES` on the DECODED payload. */
export function decodeImageDataUri(dataUri: string, maxImageBytes: number): ImagePayload {
  const match = DATA_URI_PATTERN.exec(dataUri);
  if (match === null) {
    throw badRequest('The `image_url.url` must be a base64 image data URI.', {
      param: 'messages',
      code: 'unsupported_image_source',
    });
  }
  const [, mimeType, base64] = match;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength === 0) {
    throw badRequest('The image data URI decoded to zero bytes.', {
      param: 'messages',
      code: 'unsupported_image_source',
    });
  }
  if (bytes.byteLength > maxImageBytes) {
    throw payloadTooLarge(
      `Image is ${bytes.byteLength} bytes, over the ${maxImageBytes}-byte limit. Resize or re-compress it before sending.`,
    );
  }
  return { bytes, mimeType };
}

/** Long edge → both dimensions, snapped to a whole number of 112 px patches. */
export function targetDimensions(width: number, height: number, maxLongEdge: number): PixelDimensions {
  const scale = maxLongEdge / Math.max(width, height);
  const snap = (dimension: number): number =>
    Math.max(PATCH_ALIGNMENT, Math.round((dimension * scale) / PATCH_ALIGNMENT) * PATCH_ALIGNMENT);
  return { width: snap(width), height: snap(height) };
}

/**
 * Decodes, conditionally downscales, and re-encodes as a data URI.
 *
 * An image already inside the cap is passed through UNTOUCHED — re-encoding a
 * small JPEG only loses quality and costs CPU. A corrupt or unsupported payload
 * surfaces as a 400, not a 500: it is the caller's file that is wrong.
 */
export async function prepareImage(
  dataUri: string,
  options: { maxImageBytes: number; maxLongEdge: number },
): Promise<PreparedImage> {
  const { bytes, mimeType } = decodeImageDataUri(dataUri, options.maxImageBytes);

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    throw badRequest('The image could not be decoded. Send a valid JPEG, PNG or WebP.', {
      param: 'messages',
      code: 'unsupported_image_source',
    });
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width === 0 || height === 0) {
    throw badRequest('The image has no readable dimensions. Send a valid JPEG, PNG or WebP.', {
      param: 'messages',
      code: 'unsupported_image_source',
    });
  }

  if (Math.max(width, height) <= options.maxLongEdge) {
    return {
      dataUri,
      mimeType,
      originalBytes: bytes.byteLength,
      preparedBytes: bytes.byteLength,
      width,
      height,
      downscaled: false,
    };
  }

  const target = targetDimensions(width, height, options.maxLongEdge);
  let resized: Buffer;
  try {
    resized = await sharp(bytes)
      .resize(target.width, target.height, { fit: 'fill', kernel: 'lanczos3' })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } catch {
    throw badRequest('The image could not be resized. Send a valid JPEG, PNG or WebP.', {
      param: 'messages',
      code: 'unsupported_image_source',
    });
  }

  return {
    dataUri: `data:image/jpeg;base64,${resized.toString('base64')}`,
    mimeType: 'image/jpeg',
    originalBytes: bytes.byteLength,
    preparedBytes: resized.byteLength,
    width: target.width,
    height: target.height,
    downscaled: true,
  };
}
