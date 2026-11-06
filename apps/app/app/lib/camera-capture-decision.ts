/**
 * What the camera gesture does, given what the device knows about its AI.
 *
 * Pure, so every answer is unit-testable without a browser. The hook that acts
 * on the answers is `components/intake/use-camera-capture.ts`; read its header
 * for why the tap itself can await nothing.
 *
 * `unknown` IS NOT `absent`. The connection is `unknown` while a session is
 * still resuming after a reload (`resolveAiConnection`), and a person who taps
 * "Plate photo" in that window has a working account whose allowance has not
 * been read yet. Treating `unknown` like `absent` sent that person to the
 * connect screen with no camera, on every cold open, for as long as the resume
 * took (first-run-scan-door.spec.ts, case 3). So the tap opens the camera in
 * both `connected` and `unknown`, and the photo waits for the answer before it
 * is handed to a screen that would send it.
 */
import type { AiConnection } from '#app/components/add/use-ai-connection';

/**
 * How long a picked photo waits for the connection to resolve, in ms.
 *
 * A resume is one refresh round trip plus one read of the cached account. Ten
 * seconds covers a slow phone connection without leaving a person watching a
 * dead screen for longer than a failed upload would. On expiry the photo is
 * dropped and the person lands on the scan screen as an `absent` device does.
 */
export const CONNECTION_WAIT_MS = 10_000;

/** What a tap on a camera button does. */
export type TapDecision = 'open-camera' | 'go-to-scan';

/**
 * Whether a tap opens the camera or goes to the scan screen.
 *
 * Only a DEFINITE absence goes to the scan screen, which shows the connect
 * card. `unknown` opens the camera: the answer is about to arrive and the
 * picked photo is held until it does.
 */
export function decideTap(connection: AiConnection): TapDecision {
  switch (connection) {
    case 'connected':
    case 'unknown':
      return 'open-camera';
    case 'absent':
      return 'go-to-scan';
  }
}

/**
 * - `hand-over`: park the photo for the scan screen and go there, which sends it.
 * - `wait`: the connection is not known yet; keep the photo and ask again.
 * - `go-to-scan`: go to the scan screen WITHOUT the photo, because nothing may
 *   send it. A photo parked here would sit in the one-shot slot and be sent by
 *   the next visit that does have an allowance.
 */
export type PickDecision = 'hand-over' | 'wait' | 'go-to-scan';

/**
 * What to do with a photo that was just picked.
 *
 * @param input.connection - the connection as of now.
 * @param input.hasTimedOut - whether the photo has waited `CONNECTION_WAIT_MS` already.
 */
export function decidePick({
  connection,
  hasTimedOut,
}: {
  connection: AiConnection;
  hasTimedOut: boolean;
}): PickDecision {
  switch (connection) {
    case 'connected':
      return 'hand-over';
    case 'absent':
      return 'go-to-scan';
    case 'unknown':
      return hasTimedOut ? 'go-to-scan' : 'wait';
  }
}
