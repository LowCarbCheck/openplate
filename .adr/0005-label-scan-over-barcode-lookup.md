# 0005 — Packaged-food macros come from the label, not a barcode database

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** SPRQVNTRS

## Context

openplate gets its numbers from two places: the BYOK vision provider identifying foods on a plate photo (`app/services/vision/*`), and a generic food database reached through the public lowcarbcheck food API (curated entries + BLS 4.0 + USDA FDC, ~15.8k foods). That combination handles whole foods and home cooking well — a chicken breast is nutritionally a chicken breast, and generic sources cover it.

It cannot handle **branded packaged products**, and not because the model is weak. The macros of a protein bar are not visible in a photo of the bar; two products that look identical differ several-fold in net carbs, and manufacturers reformulate without changing the wrapper. The information was never in the image.

For a low-carb tracker this has a specific, sharp consequence: **polyols**. Net carbs are `carbs − fiber − polyols`, and `polyols` is already a first-class macro throughout the app — the vision wire schema (`app/services/vision/schema.ts`), the net-carb math (`app/lib/frequent-chips.ts`, `app/lib/authoritative-net-carbs.ts`, `app/lib/local-store/schema.ts`), macro sanity checks (`app/lib/macro-sanity.ts`), and the custom-food editor (`app/components/add/manage-custom-foods.tsx`). Nothing populates it. `app/lib/quick-add-search.ts` hardcodes `polyols: null` for every curated-API result, because generic nutrition databases don't carry sugar alcohols — that data is branded-only. So sugar-free chocolate and maltitol-sweetened "keto" snacks, the exact products whose carb count is the user's entire decision, are where the app is quietly and confidently wrong.

The industry-standard answer is barcode scanning against Open Food Facts (OFF). That path was investigated in full on 2026-08-04, including live probes of OFF's contribution API, prompted by an open-source Android tracker that offers to upload product photos back to OFF when a barcode misses.

## Decision

**Packaged-food macros come from photographing the printed nutrition panel** with the same BYOK vision provider already used for plate identification. A confirmed reading is saved as a reusable local custom food, so the second purchase of a product is a one-tap re-log rather than a second vision call.

**openplate does not scan barcodes and does not integrate Open Food Facts** — not for reads, and not for photo contributions.

Concretely: the vision service gains a second *mode* (a label-reading prompt and a per-serving result shape) selected by an explicit argument, not a heuristic on the image. Capture, provider dispatch, cost accounting, and the confirm step are the existing ones and are not forked. Per-serving → per-100 g conversion is shared with manual package-label entry rather than reimplemented.

## Alternatives Considered

- **Barcode scan + OFF lookup, with photo contribution back on a miss.** The obvious answer, and technically viable: OFF's CORS policy is fully open (`Access-Control-Allow-Origin: *` on writes), so a browser could call it directly with no proxy, and anonymous photo upload works with no OFF account at all. Rejected on cost-versus-quality: it needs a `getUserMedia` scanner (the app has none today — capture is a plain `<input type="file" capture="environment">`), a WebAssembly fallback because no iOS browser implements `BarcodeDetector`, a resolution of OFF's ODbL share-alike question, a `connect-src` CSP change, and a CC-BY-SA consent flow for uploads that are public and irrevocable — all to arrive at crowdsourced data that can be staler than the label in the user's hand, with a miss rate that drops the user back into manual entry anyway.
- **Contribute photos to OFF without consuming OFF data.** Cheap — verified working anonymously. Rejected because reciprocity was the entire premise: with no consumption there is no obligation, and no natural moment in the app to trigger a contribution.
- **Ship our own branded-product database.** Licensing exposure plus permanent maintenance of a data pipeline users would depend on — the opposite of the BYOK/local-first posture.
- **Manual entry only.** Retained as the fallback for unreadable or absent panels, but typing a full nutrition panel is exactly the friction that loses a daily user.

## Consequences

- **`polyols` gets its first real source.** A printed panel lists sugar alcohols; a model reading it can return them. This is the only path in the app that makes net carbs correct for the products where the error is largest — and it needs no schema change, because the field is already plumbed end to end.
- **Numbers come from the product physically in the user's hand** — more authoritative and more current than any crowdsourced record, and it works for products no database has ever heard of.
- **No new external dependency and no data leaves the BYOK path.** No third-party service integration, no ODbL or CC-BY-SA obligation, no upload-consent flow, no CSP change. The local-first and accountless posture is preserved unchanged.
- **Costs one vision call per new product**, on the user's own key. Mitigated by persisting a reusable custom food — once per product, not once per log.
- **OCR of a curved, glossy, or partly-obscured panel will sometimes be wrong.** The confirm step must therefore present read values as editable and explicitly unverified, reusing the existing macro-sanity vocabulary; a wrong macro entering the diary silently is worse than a failed scan. Failure must also be distinguishable from "no foods found on that plate."
- **The panel must be physically present.** There is no way to log a packaged food from memory, or from a barcode alone, on first encounter.
- **Users arriving from mainstream trackers will notice barcode scanning is missing.** Accepted; this ADR is the answer to that question.
- **Reversal path is preserved.** The parked barcode/OFF design and the verified OFF API research are retained in the internal tracker (milestone M116, kept `Deferred`) — including the non-obvious findings that anonymous *photo* upload succeeds while anonymous *data* writes are rejected, and that `User-Agent` is a forbidden header in `fetch` so OFF's allowlisted `X-User-Agent` must be used from a browser. If label scanning proves insufficient in practice, that work restarts from a researched position rather than from scratch.

## References

- Code touched by this decision: `app/services/vision/prompt.ts` (single plate-only system prompt today), `app/services/vision/schema.ts` (`polyols` already in the wire schema), `app/lib/quick-add-search.ts` (`polyols: null` hardcoded), `app/lib/photo-constraints.ts` (`downscaleToJpeg` already honours a per-call `maxDimension` override, so label captures can request more detail without raising the plate default), `app/lib/macro-sanity.ts`, `app/routes/scan.tsx`.
- Internal tracker (workspace repo, not part of this repository): **M123/10** implements label scan and depends on **M123/06** for per-serving → per-100 g conversion; **M116** holds the deferred barcode/OFF design and the OFF API research; **M119** established that generic FDC data carries no polyol values.
- Open Food Facts API documentation: <https://openfoodfacts.github.io/openfoodfacts-server/api/>
- `BarcodeDetector` browser support: <https://caniuse.com/mdn-api_barcodedetector>
