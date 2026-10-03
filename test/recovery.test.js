import test from 'node:test';
import assert from 'node:assert/strict';
import { operationsFor } from '../src/operations.js';
import { commandFor, remoteSource } from '../src/ssh.js';
test('recovery refuses source target, missing checks and absent confirmation', () => {
  let backup = { id: 'backup', serverId: 'source', healthChecks: [{ url: 'http://localhost/health', status: 200 }] };
  const operations = operationsFor({ get: () => backup }, { dataDir: '/tmp/reforge' });
  assert.throws(() => operations.recover({ id: 'source', name: 'DE-01' }, { backupId: 'backup', confirm: 'DE-01' }), /separate/);
  assert.throws(() => operations.recover({ id: 'target', name: 'LAB' }, { backupId: 'backup', confirm: 'wrong' }), /Type/);
  backup = { ...backup, healthChecks: [] };
  assert.throws(() => operations.recover({ id: 'target', name: 'LAB' }, { backupId: 'backup', confirm: 'LAB' }), /no application/);
});
test('remote bootstrap fits Windows command line and interpolates only base64', async () => {
  const command = commandFor(await remoteSource(), { action: 'discover', value: "'; touch /tmp/injected; '" });
  assert.ok(command.length < 25000);
  assert.ok(!command.includes('touch /tmp'));
  assert.ok(command.includes('zlib.decompress'));
});
