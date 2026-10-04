/**
 * The searcher behind `photo-path-guard.test.ts`: given the bytes of a
 * photograph and a unique marker inside it, it looks for that photograph in
 * every dress a careless log line could put it in.
 *
 * WHY SO MANY DRESSES. A leak is rarely `console.log(base64)`. It is a
 * `Buffer` printed by `${buffer}` or `util.inspect` (`<Buffer ff d8 ...>`), a
 * `JSON.stringify(buffer)` (`{"type":"Buffer","data":[255,216,...]}`), an
 * error message that quotes a slice of a URL-encoded form, a base64 string cut
 * to 200 characters. The marker is what makes a CUT leak findable: it is 24
 * bytes of ASCII the test planted at three offsets, so any 12-byte window of
 * it that survives in any dress is a hit, whichever slice of the photograph the
 * leak kept.
 *
 * WHY THE THREE ALIGNMENTS. Base64 encodes three bytes to four characters, so
 * the same 12 bytes encode differently depending on where they start modulo
 * three. A searcher that looked for one alignment would miss two thirds of the
 * windows. The characters at the edges of a window, which also depend on the
 * bytes next to it, are left out of the needle.
 *
 * A SEARCHER THAT FINDS NOTHING PASSES EVERY TEST, so `photo-path-guard.test.ts`
 * feeds this one text that contains the marker in each dress and requires a
 * hit for each.
 */
import type pg from 'pg';

/** One body of text to search, and where it came from, for the failure message. */
export interface Haystack {
  source: string;
  text: string;
}

interface Needle {
  label: string;
  text: string;
}

export interface LeakSearcher {
  /** Every needle found in any haystack, as `source: needle label`. Empty means clean. */
  find(haystacks: readonly Haystack[]): string[];
  /** How many needles the searcher looks for, so a test can show it is not empty. */
  needleCount: number;
}

/** The bytes of a marker a window is cut from. 12 is long enough that a chance hit in random bytes is out of the question. */
export const WINDOW_BYTES = 12;

/** The first and last characters of a window's base64 depend on its neighbours; only the characters fixed by the window itself are used. */
function base64WindowText(input: { window: Buffer; alignment: number }): string {
  const { window, alignment } = input;
  const encoded = Buffer.concat([Buffer.alloc(alignment), window]).toString('base64');
  const start = Math.ceil((4 * alignment) / 3);
  const end = Math.floor((8 * (alignment + window.length)) / 6);
  return encoded.slice(start, end);
}

function toUrlSafe(base64: string): string {
  return base64.replaceAll('+', '-').replaceAll('/', '_');
}

function squash(text: string): string {
  return text.replaceAll(/\s+/g, '');
}

/** The ways a run of bytes shows up in text, as needles. Whitespace is squashed out of every needle and out of every haystack. */
function byteRunNeedles(input: { label: string; bytes: Buffer }): Needle[] {
  const { label, bytes } = input;
  const hex = bytes.toString('hex');
  return [
    { label: `${label} as hex`, text: hex },
    { label: `${label} as upper-case hex`, text: hex.toUpperCase() },
    // `<Buffer ff d8 ...>` and a hex dump: the same digits with spaces, squashed.
    { label: `${label} as a number array`, text: [...bytes].join(',') },
  ];
}

function windowNeedles(window: Buffer, index: number): Needle[] {
  const label = `marker window ${index}`;
  const needles: Needle[] = [
    { label: `${label} as text`, text: window.toString('latin1') },
    ...byteRunNeedles({ label, bytes: window }),
  ];
  for (let alignment = 0; alignment < 3; alignment += 1) {
    const standard = base64WindowText({ window, alignment });
    needles.push(
      { label: `${label} as base64 at alignment ${alignment}`, text: standard },
      { label: `${label} as URL-safe base64 at alignment ${alignment}`, text: toUrlSafe(standard) },
      { label: `${label} as URL-encoded base64 at alignment ${alignment}`, text: encodeURIComponent(standard) },
    );
  }
  return needles;
}

/** The haystack as it is, with JSON escapes undone, and with whitespace squashed: three views of one text. */
function views(text: string): string[] {
  const unescaped = text
    .replaceAll(String.raw`\/`, '/')
    .replaceAll(/\\u002f/gi, '/')
    .replaceAll(/\\u002b/gi, '+')
    .replaceAll(/\\u003d/gi, '=');
  return [text, unescaped, squash(text), squash(unescaped)];
}

export function createLeakSearcher(input: { image: Buffer; marker: Buffer }): LeakSearcher {
  const { image, marker } = input;
  const standard = image.toString('base64');
  const needles: Needle[] = [
    { label: 'the image as base64', text: standard },
    { label: 'the image as URL-safe base64', text: toUrlSafe(standard) },
    { label: 'the image as URL-encoded base64', text: encodeURIComponent(standard) },
    ...byteRunNeedles({ label: 'the image', bytes: image }),
    // The raw marker, for a Buffer written to a stream as it is.
    { label: 'the marker as text', text: marker.toString('latin1') },
  ];
  for (let start = 0; start + WINDOW_BYTES <= marker.length; start += 1) {
    needles.push(...windowNeedles(marker.subarray(start, start + WINDOW_BYTES), start));
  }
  // Squashed once, so a needle with a space in it (none today) still matches a squashed haystack.
  const prepared = needles.map((needle) => ({ label: needle.label, text: squash(needle.text) }));

  return {
    needleCount: prepared.length,
    find(haystacks) {
      const found = new Set<string>();
      for (const haystack of haystacks) {
        const texts = views(haystack.text);
        for (const needle of prepared) {
          if (texts.some((text) => text.includes(needle.text))) found.add(`${haystack.source}: ${needle.label}`);
        }
      }
      return [...found];
    },
  };
}

const SAFE_IDENTIFIER = /^[a-z0-9_]+$/;

export interface DatabaseScan {
  haystacks: Haystack[];
  /** Columns read, and how many of them are `bytea`, so a test can show the scan is not empty. */
  columns: number;
  byteaColumns: number;
}

/**
 * Every column of every base table in the `public` schema, read through
 * `information_schema` so a table added next month is searched without anyone
 * editing a list. Each column's non-null values become one haystack; `bytea` is
 * read as bytes and offered as text, hex and base64.
 */
export async function readDatabaseHaystacks(pool: pg.Pool): Promise<DatabaseScan> {
  const listed = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT c.table_name, c.column_name, c.data_type
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position`,
  );
  const haystacks: Haystack[] = [];
  let byteaColumns = 0;
  for (const column of listed.rows) {
    const table = column.table_name;
    const name = column.column_name;
    // Our own schema's names, never user input; checked anyway because they are
    // interpolated, which Postgres does not let a parameter do.
    if (!SAFE_IDENTIFIER.test(table) || !SAFE_IDENTIFIER.test(name))
      throw new Error(`unexpected identifier ${table}.${name}`);
    const source = `database ${table}.${name}`;
    if (column.data_type === 'bytea') {
      byteaColumns += 1;
      const result = await pool.query<{ value: Buffer }>(
        `SELECT "${name}" AS value FROM "${table}" WHERE "${name}" IS NOT NULL`,
      );
      const buffers = result.rows.map((row) => row.value);
      haystacks.push(
        { source: `${source} (as bytes)`, text: buffers.map((value) => value.toString('latin1')).join('\n') },
        { source: `${source} (as hex)`, text: buffers.map((value) => value.toString('hex')).join('\n') },
        { source: `${source} (as base64)`, text: buffers.map((value) => value.toString('base64')).join('\n') },
      );
      continue;
    }
    const result = await pool.query<{ value: string }>(
      `SELECT "${name}"::text AS value FROM "${table}" WHERE "${name}" IS NOT NULL`,
    );
    haystacks.push({ source, text: result.rows.map((row) => row.value).join('\n') });
  }
  return { haystacks, columns: listed.rows.length, byteaColumns };
}
