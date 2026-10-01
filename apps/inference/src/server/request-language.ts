/**
 * Which app language a request asks for, read from its `Accept-Language`
 * header.
 *
 * The caller's prompt is discarded (see `chat-completions.ts`), so this header
 * is the ONE language signal the service reads. It decides one thing: whether
 * the pipeline makes a second, text-only call that translates the food names
 * (`pipeline/translate-names.ts`). `null` means "make no such call", and that is
 * the answer for English, for no header, for `*` and for any language the app
 * does not ship, so a request with no usable signal takes exactly the path it
 * took before translation existed.
 *
 * `Accept-Language` is a CORS-safelisted request header, so a browser client
 * can send it without a preflight allowance in `cors.ts`.
 */
import { APP_LANGUAGES, type AppLanguage } from '../contract/plate-identification.js';

/** A quality value as RFC 9110 writes it: `0` to `1`, at most three decimals. */
const QUALITY_PATTERN = /^q=(0(\.\d{0,3})?|1(\.0{0,3})?)$/i;

interface WeightedLanguage {
  language: AppLanguage;
  quality: number;
}

function isAppLanguage(code: string): code is AppLanguage {
  return APP_LANGUAGES.some((language) => language === code);
}

/**
 * One comma-separated entry, such as `de-DE;q=0.9`, as an app language and its
 * weight. `null` for a tag outside the app languages, for `*`, for a malformed
 * weight and for `q=0`, which RFC 9110 defines as "not acceptable".
 */
function parseEntry(entry: string): WeightedLanguage | null {
  const [tag = '', ...parameters] = entry.split(';').map((part) => part.trim());
  const primary = tag.split('-')[0]?.toLowerCase() ?? '';
  if (!isAppLanguage(primary)) return null;

  const qualityParameter = parameters.find((parameter) => /^q=/i.test(parameter));
  if (qualityParameter === undefined) return { language: primary, quality: 1 };
  if (!QUALITY_PATTERN.test(qualityParameter)) return null;

  const quality = Number(qualityParameter.slice(2));
  if (quality === 0) return null;
  return { language: primary, quality };
}

/**
 * The highest-weighted app language in an `Accept-Language` header, or `null`
 * when that language is English or when no entry names an app language.
 *
 * Regions are ignored (`de-DE` is `de`) and matching is case-insensitive. Two
 * entries with the same weight resolve to the earlier one, which is the order
 * the client wrote them in.
 */
export function requestLanguage(header: string | undefined): AppLanguage | null {
  if (header === undefined) return null;

  let best: WeightedLanguage | null = null;
  for (const entry of header.split(',')) {
    const candidate = parseEntry(entry);
    if (candidate === null) continue;
    if (best === null || candidate.quality > best.quality) best = candidate;
  }

  if (best === null || best.language === 'en') return null;
  return best.language;
}
