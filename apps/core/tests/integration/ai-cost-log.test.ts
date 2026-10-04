/**
 * What a completion cost, summed per UTC day in `ai_instance_days.cost_micro_usd`
 * (2026-10-05), against real Postgres and a real listening upstream.
 *
 * WHAT ONLY A DATABASE CAN SAY. That the column exists (migration 0032), that
 * the upsert creates the day's row on an instance with NO ceiling (which has no
 * row until now) and adds to it afterwards, and that adding a cost touches
 * neither request counter. The unit suite proves the proxy reads the number;
 * this proves it lands.
 *
 * CONTROLS: an answer with no usage writes nothing, and an instance WITH a
 * ceiling keeps counting requests in the same row.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { aiInstanceDays } from '../../src/db/schema.js';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { startService, type ServiceHarness } from './service-harness.js';

const BODY = { model: 'm', messages: [{ role: 'user', content: 'what is on this plate?' }] };

let database: TestDatabase;
let upstream: Server;
let upstreamBaseUrl: string;
let answer: string;

before(async () => {
  database = await setupTestDatabase();
  upstream = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(answer);
    });
  });
  upstream.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => upstream.once('listening', resolve));
  // SAFETY: `listen(0, host)` binds a TCP port; Node returns the string form
  // only for a Unix domain socket, which this never opens.
  upstreamBaseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  answer = JSON.stringify({
    model: 'google/gemini-3.7-flash',
    choices: [{ message: { content: 'a plate' } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.000412 },
  });
});

async function scanTwice(service: ServiceHarness): Promise<void> {
  const session = await service.signupThroughInvite({ email: 'anna@example.org', dailyAiLimit: 10 });
  for (let index = 0; index < 2; index += 1) {
    const response = await service.request({
      method: 'POST',
      path: '/v1/chat/completions',
      accessToken: session.tokens.accessToken,
      body: BODY,
    });
    assert.equal(response.status, 200);
  }
}

/** The write is after the response, so the row is polled for, with a bound. */
async function costRows(expectedRows: number): Promise<{ count: number; trialCount: number; costMicroUsd: number }[]> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const rows = await database.db.select().from(aiInstanceDays);
    if (rows.length >= expectedRows || Date.now() > deadline) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('two priced answers add up on the day, on an instance with no ceiling', async () => {
  const service = await startService({
    db: database.db,
    ai: { baseUrl: upstreamBaseUrl, apiKey: 'sk-the-operators-key' },
  });
  try {
    assert.deepEqual(await database.db.select().from(aiInstanceDays), [], 'no row before the first answer');
    await scanTwice(service);
    // Polled until BOTH have landed: the second write follows the second response.
    const deadline = Date.now() + 2_000;
    let rows = await costRows(1);
    while (rows[0]?.costMicroUsd !== 824 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      rows = await database.db.select().from(aiInstanceDays);
    }
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.costMicroUsd, 824, 'two answers of 412 micro dollars');
    assert.equal(rows[0]?.count, 0, 'no ceiling is set, so no request counter moves');
    assert.equal(rows[0]?.trialCount, 0);
  } finally {
    await service.close();
  }
});

test('with a ceiling the cost lands in the same row as the request count, and touches neither counter', async () => {
  const service = await startService({
    db: database.db,
    ai: { baseUrl: upstreamBaseUrl, apiKey: 'sk-the-operators-key', instanceDailyLimit: 100 },
  });
  try {
    await scanTwice(service);
    const deadline = Date.now() + 2_000;
    let rows = await costRows(1);
    while (rows[0]?.costMicroUsd !== 824 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      rows = await database.db.select().from(aiInstanceDays);
    }
    assert.equal(rows.length, 1, 'one row per day');
    assert.equal(rows[0]?.count, 2);
    assert.equal(rows[0]?.costMicroUsd, 824);
  } finally {
    await service.close();
  }
});

test('CONTROL: an answer that reports no usage writes no cost and creates no row', async () => {
  answer = JSON.stringify({ choices: [{ message: { content: 'a plate' } }] });
  const service = await startService({
    db: database.db,
    ai: { baseUrl: upstreamBaseUrl, apiKey: 'sk-the-operators-key' },
  });
  try {
    await scanTwice(service);
    // Nothing to wait for: give the after-response work its chance, then look.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(await database.db.select().from(aiInstanceDays), []);
  } finally {
    await service.close();
  }
});
