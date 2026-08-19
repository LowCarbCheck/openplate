/**
 * An in-process fake `/v1/embeddings` server — a real express app on an
 * ephemeral port, for the same reason `fake-runtime.ts` is one: the thing under
 * test is wire behaviour (the `Authorization` header, a real 401 status), and a
 * stubbed `fetch` would only prove we called a mock the way we think we do.
 *
 * It records the `Authorization` header of every request and can be told to
 * answer a non-2xx, which is what makes "a rotated key degrades retrieval and
 * says so on `/readyz`" testable as the 401 it actually is.
 */
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';

/**
 * The embeddings request as this fake reads it. `input` is the array of texts
 * the real client (`src/food-source/embedding.ts`) sends; anything else is
 * recorded as an empty batch rather than a 500, so a malformed-request test
 * still sees the status it is asserting.
 */
const EmbeddingsRequestSchema = z.object({
  input: z.array(z.string()).catch([]),
});

export interface FakeEmbeddings {
  baseUrl: string;
  /** The `Authorization` header of each request, in order. `null` when none was sent. */
  received: Array<string | null>;
  /** Status for `POST /v1/embeddings`. 401 is the rejected-key case. */
  setStatus(status: number): void;
  close(): Promise<void>;
}

export async function startFakeEmbeddings(): Promise<FakeEmbeddings> {
  const received: Array<string | null> = [];
  let status = 200;

  const app = express();
  app.use(express.json());
  app.post('/v1/embeddings', (req, res) => {
    received.push(req.get('authorization') ?? null);
    if (status !== 200) {
      res.status(status).json({ error: 'embeddings unavailable' });
      return;
    }
    const { input } = EmbeddingsRequestSchema.parse(req.body);
    res.status(200).json({ data: input.map((_text, index) => ({ index, embedding: [1, 0] })) });
  });

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  // SAFETY: `app.listen` has already resolved its `listening` event above, and this
  // fake binds a TCP port (not a UNIX socket), so `address()` is an `AddressInfo`
  // here and never `null` or the pipe-name string.
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    received,
    setStatus(next: number) {
      status = next;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
