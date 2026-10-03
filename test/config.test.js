import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
test('configuration refuses missing authentication and encryption keys', () => {
  assert.throws(() => config({}), /TOKEN/);
  assert.throws(() => config({ REFORGE_TOKEN: 't'.repeat(32) }), /KEY/);
  assert.equal(config({ REFORGE_TOKEN: 't'.repeat(32), REFORGE_BACKUP_KEY: 'ab'.repeat(32) }).key.length, 32);
});
