import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler, localClock } from '../src/scheduler.js';
test('daily backup runs once per Moscow date and waits while another job runs', () => {
  let policy = { id: 'source', serverId: 'source', enabled: true, time: '03:00', paths: ['/srv/app'], healthChecks: [] };
  let started = 0;
  const jobs = { active: true, start() { started++; } };
  const store = { list: () => [policy], get: () => ({ id: 'source' }), put(kind, value) { policy = value; } };
  const scheduler = new Scheduler({ store, jobs, operations: { backup: () => async () => {} } });
  scheduler.tick(new Date('2026-10-02T23:59:00Z')); assert.equal(started, 0);
  jobs.active = false;
  scheduler.tick(new Date('2026-10-03T00:00:00Z')); assert.equal(started, 1);
  scheduler.tick(new Date('2026-10-03T00:30:00Z')); assert.equal(started, 1);
  scheduler.tick(new Date('2026-10-04T00:00:00Z')); assert.equal(started, 2);
  assert.deepEqual(localClock(new Date('2026-10-03T00:00:00Z'), 'Europe/Moscow'), { date: '2026-10-03', time: '03:00' });
});
