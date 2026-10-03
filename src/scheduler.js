export function localClock(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: values.year + '-' + values.month + '-' + values.day, time: values.hour + ':' + values.minute };
}
export class Scheduler {
  constructor({ store, jobs, operations, timezone = 'Europe/Moscow' }) {
    this.store = store; this.jobs = jobs; this.operations = operations; this.timezone = timezone;
    localClock(new Date(), timezone);
  }
  tick(now = new Date()) {
    if (this.jobs.active) return;
    const clock = localClock(now, this.timezone);
    for (const policy of this.store.list('schedules')) {
      if (!policy.enabled || policy.lastDate === clock.date || clock.time < policy.time) continue;
      const server = this.store.get('servers', policy.serverId);
      if (!server) continue;
      try {
        const operation = this.operations.backup(server, { paths: policy.paths, healthChecks: policy.healthChecks, confirmDowntime: true });
        this.store.put('schedules', { ...policy, lastDate: clock.date });
        this.jobs.start('backup', server.id, operation, { scheduleId: policy.id });
      } catch (error) {
        this.store.put('schedules', { ...policy, lastDate: clock.date, lastError: error.message });
      }
      return;
    }
  }
  start() {
    this.timer = setInterval(() => this.tick(), 30000);
    this.timer.unref();
    this.tick();
  }
  stop() { clearInterval(this.timer); }
}
