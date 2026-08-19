/**
 * The honest type of a value that has been through `JSON.parse` and nothing
 * else.
 *
 * Every wire boundary in this service — a request body, a food API's response,
 * the FDC dataset on disk — produces exactly this set of values and no more.
 * Naming it is what lets those boundaries stop saying `unknown`: `unknown`
 * claims "this could be a Buffer, a class instance, a function", which is false
 * and pushes the reader towards `typeof` sniffing. `JsonValue` says the true
 * thing, and every consumer still has to run a zod schema over it before
 * reading a field.
 */
import { z } from 'zod';

/** Schema form, for parsing a JSON payload out of a larger object. */
export const JsonValueSchema = z.json();

export type JsonValue = z.infer<typeof JsonValueSchema>;
