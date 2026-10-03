import { InputError } from './validation.js';
export class Jobs {
  constructor(store, notify = async () => {}) { this.store = store; this.notify = notify; this.active = false; }
  start(type, serverId, operation, extra = {}) {
    if (this.active) throw new InputError('Another operation is running. Wait for it to finish.', 409);
    this.active = true;
    const job = this.store.put('jobs', { type, serverId, ...extra, status: 'queued', createdAt: new Date().toISOString(), events: [] });
    queueMicrotask(async () => {
      const startedAt = new Date().toISOString();
      const update = changes => this.store.put('jobs', { ...this.store.get('jobs', job.id), ...changes });
      const event = message => { const current = this.store.get('jobs', job.id); update({ events: [...current.events, { at: new Date().toISOString(), message }] }); };
      try {
        update({ status: 'running', startedAt });
        const result = await operation(event, job);
        update({ status: 'succeeded', result, endedAt: new Date().toISOString(), durationSeconds: Math.round((Date.now() - Date.parse(startedAt)) / 1000) });
      } catch (error) {
        update({ status: 'failed', error: error.message, endedAt: new Date().toISOString() });
      } finally {
        try { await this.notify(this.store.get('jobs', job.id)); } catch { event('Telegram notification failed; operation result is unchanged'); }
        this.active = false;
      }
    });
    return job;
  }
}
