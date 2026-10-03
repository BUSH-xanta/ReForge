import { config } from './config.js';
import { Store } from './store.js';
import { Jobs } from './jobs.js';
import { createApp } from './api.js';
import { operationsFor } from './operations.js';
import { storageConfig, storageFor } from './storage.js';
import { telegramNotifier } from './telegram.js';
import { Scheduler } from './scheduler.js';
const settings = config();
const store = new Store(settings.dataDir);
const jobs = new Jobs(store, telegramNotifier());
const storage = storageFor(storageConfig());
const operations = operationsFor(store, settings, storage);
const scheduler = new Scheduler({ store, jobs, operations, timezone: settings.timezone });
const app = createApp({ store, jobs, config: settings, operations });
app.on('listening', () => scheduler.start());
app.listen(settings.port, settings.host, () => console.log(`ReForge listening on http://${settings.host}:${settings.port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  scheduler.stop();
  app.close(async () => {
    // Let remote snapshot operations finish and restart source services before exiting.
    while (jobs.active) await new Promise(resolve => setTimeout(resolve, 500));
    store.close(); process.exit(0);
  });
});
