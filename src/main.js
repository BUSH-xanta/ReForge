import { config } from './config.js';
import { Store } from './store.js';
import { Jobs } from './jobs.js';
import { createApp } from './api.js';
const settings = config();
const store = new Store(settings.dataDir);
const jobs = new Jobs(store);
const app = createApp({ store, jobs, config: settings });
app.listen(settings.port, settings.host, () => console.log(`ReForge listening on http://${settings.host}:${settings.port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  app.close(() => { store.close(); process.exit(0); });
});
