import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { Jobs } from '../src/jobs.js';
import { createApp } from '../src/api.js';
import { validateServer, validateProjectPaths, validateHealthChecks } from '../src/validation.js';
import { sshArgs } from '../src/ssh.js';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'reforge-test-'));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, dir };
}
test('reject SSH option injection and unsafe project paths', () => {
  const valid = { name: 'DE-01', host: '192.0.2.1', keyPath: join(tmpdir(), 'id_ed25519') };
  assert.throws(() => validateServer({ ...valid, host: '-oProxyCommand=evil' }));
  assert.throws(() => validateServer({ ...valid, user: 'root;id' }));
  assert.throws(() => validateServer({ ...valid, keyPath: 'relative' }));
  assert.throws(() => validateProjectPaths(['/srv/../etc']));
  assert.throws(() => validateProjectPaths(['/etc']));
  assert.throws(() => validateHealthChecks([{ url: 'https://production.example.com' }]));
  assert.deepEqual(validateProjectPaths(['/srv/app/', '/srv/app']), ['/srv/app']);
  assert.ok(sshArgs(validateServer(valid)).includes('StrictHostKeyChecking=yes'));
});
test('registry survives reopen and interrupted jobs are failed', t => {
  const { store, dir } = fixture(t);
  const saved = store.put('servers', { name: 'DE-01' });
  store.put('jobs', { status: 'running', type: 'backup' });
  const reopened = new Store(dir);
  assert.equal(reopened.get('servers', saved.id).name, 'DE-01');
  assert.equal(reopened.list('jobs')[0].status, 'failed');
  reopened.close();
});
test('jobs reject overlap and persist failure', async t => {
  const { store } = fixture(t);
  const jobs = new Jobs(store);
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const job = jobs.start('backup', 'server', async () => { await wait; throw new Error('test failure'); });
  assert.throws(() => jobs.start('backup', 'server', async () => {}), /Another/);
  release();
  while (jobs.active) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(store.get('jobs', job.id).status, 'failed');
});
test('API rejects unauthorized and cross-origin mutations; stores a server', async t => {
  const { store } = fixture(t);
  const token = 't'.repeat(32);
  const app = createApp({ store, jobs: new Jobs(store), config: { token } });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = 'http://127.0.0.1:' + app.address().port;
  assert.equal((await fetch(base + '/api/state')).status, 401);
  assert.equal((await fetch(base + '/healthz')).status, 200);
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/servers', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  const created = await fetch(base + '/api/servers', { method: 'POST', headers, body: JSON.stringify({ name: 'DE-01', host: '192.0.2.1', keyPath: join(tmpdir(), 'id_ed25519') }) });
  assert.equal(created.status, 201);
  assert.equal((await (await fetch(base + '/api/state', { headers })).json()).servers.length, 1);
});
