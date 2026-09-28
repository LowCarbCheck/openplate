/**
 * Deterministic AAD (additional authenticated data) construction for the
 * data envelope (design spec D2). A canonical, fixed-key-order JSON
 * serialization is deterministic enough for this purpose (the fields are
 * always the same three small integers) — no custom binary framing needed.
 */
import type { EnvelopeAadFields } from './types';

export function buildEnvelopeAad(fields: EnvelopeAadFields): Uint8Array {
  const canonical = JSON.stringify({
    accountId: fields.accountId,
    blobVersion: fields.blobVersion,
    payloadSchemaVersion: fields.payloadSchemaVersion,
  });
  return new TextEncoder().encode(canonical);
}
