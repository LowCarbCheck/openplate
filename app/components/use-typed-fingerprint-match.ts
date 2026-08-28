/**
 * "Is what was typed the fingerprint of the key that actually arrived?"
 *
 * A BOOLEAN, and that return type is the load-bearing part. Both ceremonies in
 * this app (the clinician grant, `share-verify-step.tsx`; the study enrolment,
 * `study-verify-step.tsx`) need to know whether the twelve characters match,
 * and NEITHER may put the value it computed on the screen: the whole ceremony
 * rests on the typed value arriving through a second channel — a voice
 * (ADR-0002) or a printed consent document (ADR-0003) — and a screen that
 * shows its own answer first collapses both channels into the link. A hook
 * that hands back a string could be rendered; one that hands back a boolean
 * cannot.
 *
 * The disabled submit button this drives is a courtesy, never the gate.
 * `runShareCeremony` and `runEnrolmentCeremony` both re-check the typed value
 * against the received key before they pin, wrap or send anything. A UI can be
 * bypassed; those functions cannot.
 *
 * Computed in an effect because the fingerprint is a SHA-256 of the key bytes,
 * which WebCrypto only offers asynchronously. A malformed key is simply "no
 * match" — neither control ever has to explain base64.
 */
import { useEffect, useState } from 'react';

import { base64ToBytes } from '#app/lib/sync/engine/crypto/base64';
import { shareFingerprintMatchesTyped, shareKeyFingerprint } from '#app/lib/sync/engine/crypto/share-wrap';

/** Whether `typed` is the fingerprint of `publicKeyBase64`. Never throws: an unreadable key is "no match". */
export async function typedFingerprintMatches({
  publicKeyBase64,
  typedFingerprint,
}: {
  publicKeyBase64: string;
  typedFingerprint: string;
}): Promise<boolean> {
  try {
    const fingerprint = await shareKeyFingerprint(base64ToBytes(publicKeyBase64));
    return shareFingerprintMatchesTyped({ typed: typedFingerprint, fingerprint });
  } catch {
    return false;
  }
}

/** The hook form. `false` until the first computation lands, which is also its value during server rendering. */
export function useTypedFingerprintMatch({
  publicKeyBase64,
  typedFingerprint,
}: {
  publicKeyBase64: string;
  typedFingerprint: string;
}): boolean {
  const [isMatch, setIsMatch] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      const matched = await typedFingerprintMatches({ publicKeyBase64, typedFingerprint });
      if (!isCancelled) setIsMatch(matched);
    })();
    return () => {
      isCancelled = true;
    };
  }, [publicKeyBase64, typedFingerprint]);

  return isMatch;
}
