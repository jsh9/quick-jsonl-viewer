import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatBytes,
  formatInteger,
  formatPercent
} from '../../../src/webview/lib/format';

test('webview format helpers clamp and format values like the embedded viewer', () => {
  assert.equal(formatPercent(-1), '0.0%');
  assert.equal(formatPercent(12.345), '12.3%');
  assert.equal(formatPercent(101), '100.0%');

  assert.equal(formatBytes(Number.NaN), '0 B');
  assert.equal(formatBytes(-1), '0 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(10 * 1024), '10.0 KB');

  assert.equal(formatInteger(Number.POSITIVE_INFINITY), 'Infinity');
  assert.equal(formatInteger(1234.8), '1,234');
});
