/**
 * Unit tests for `#app/lib/csv` — the tiny RFC-4180 CSV encoder. No DB, no I/O;
 * pure string work, so these run without a database connection.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { encodeCsv } from '../../app/lib/csv';

const CRLF = '\r\n';

describe('encodeCsv', () => {
  it('joins the header row and data rows with CRLF and no trailing newline', () => {
    const csv = encodeCsv({
      header: ['a', 'b'],
      rows: [
        [1, 2],
        [3, 4],
      ],
    });

    assert.strictEqual(csv, `a,b${CRLF}1,2${CRLF}3,4`);
  });

  it('emits just the header when there are no rows', () => {
    const csv = encodeCsv({ header: ['name', 'value'], rows: [] });

    assert.strictEqual(csv, 'name,value');
  });

  it('renders null and undefined as empty cells (never 0)', () => {
    const csv = encodeCsv({ header: ['x', 'y', 'z'], rows: [[null, undefined, 0]] });

    assert.strictEqual(csv, `x,y,z${CRLF},,0`);
  });

  it('renders numbers and booleans as their string forms', () => {
    const csv = encodeCsv({ header: ['n', 'b1', 'b2'], rows: [[1.5, true, false]] });

    assert.strictEqual(csv, `n,b1,b2${CRLF}1.5,true,false`);
  });

  it('quotes a cell containing a comma', () => {
    const csv = encodeCsv({ header: ['name'], rows: [['Beans, baked']] });

    assert.strictEqual(csv, `name${CRLF}"Beans, baked"`);
  });

  it('quotes a cell containing a newline', () => {
    const csv = encodeCsv({ header: ['note'], rows: [['line1\nline2']] });

    assert.strictEqual(csv, `note${CRLF}"line1\nline2"`);
  });

  it('quotes a cell containing a carriage return', () => {
    const csv = encodeCsv({ header: ['note'], rows: [['a\rb']] });

    assert.strictEqual(csv, `note${CRLF}"a\rb"`);
  });

  it('doubles inner double-quotes and wraps the cell in quotes', () => {
    const csv = encodeCsv({ header: ['name'], rows: [['12" pizza']] });

    assert.strictEqual(csv, `name${CRLF}"12"" pizza"`);
  });

  it('hardens a cell that starts with = against formula injection', () => {
    const csv = encodeCsv({ header: ['name'], rows: [['=1+1']] });

    assert.strictEqual(csv, `name${CRLF}'=1+1`);
  });

  it('hardens leading +, -, and @ triggers', () => {
    const csv = encodeCsv({
      header: ['plus', 'minus', 'at'],
      rows: [['+SUM(A1)', '-2', '@cmd']],
    });

    assert.strictEqual(csv, `plus,minus,at${CRLF}'+SUM(A1),'-2,'@cmd`);
  });

  it('does not harden a trigger character that is not first', () => {
    const csv = encodeCsv({ header: ['name'], rows: [['a=b']] });

    assert.strictEqual(csv, `name${CRLF}a=b`);
  });

  it('hardens first, then RFC-quotes when the hardened cell also needs quoting', () => {
    const csv = encodeCsv({ header: ['name'], rows: [['=HYPERLINK("x"),y']] });

    // Leading '=' → prefixed with a quote; then the comma + inner quotes force
    // wrapping, with the inner quotes doubled.
    assert.strictEqual(csv, `name${CRLF}"'=HYPERLINK(""x""),y"`);
  });

  it('hardens a numeric-looking negative value passed as a string', () => {
    const csv = encodeCsv({ header: ['delta'], rows: [['-5']] });

    assert.strictEqual(csv, `delta${CRLF}'-5`);
  });
});
