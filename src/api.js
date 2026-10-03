import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { InputError, validateServer, validateProjectPaths, validateHealthChecks } from './validation.js';
import { runRemote } from './ssh.js';
const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
export function createApp({ store, jobs, config, operations = {} }) {
  function json(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); }
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(request.url, 'http://localhost');
      const method = request.method;
      if (url.pathname === '/healthz' && method === 'GET') return json(response, 200, { status: 'ok' });
      if (!url.pathname.startsWith('/api/')) {
        const asset = assets[url.pathname];
        if (!asset || method !== 'GET') throw new InputError('Not found', 404);
        const body = await readFile(new URL('../public/' + asset[0], import.meta.url));
        response.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8', 'Cache-Control': 'no-cache' });
        return response.end(body);
      }
      const supplied = Buffer.from((request.headers.authorization || '').replace(/^Bearer /, ''));
      const expected = Buffer.from(config.token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new InputError('Unauthorized', 401);
      if (request.headers.origin && request.headers.origin !== 'http://' + request.headers.host && request.headers.origin !== 'https://' + request.headers.host) throw new InputError('Cross-origin request rejected', 403);
      let body = {};
      if (method === 'POST') {
        if (!(request.headers['content-type'] || '').startsWith('application/json')) throw new InputError('Use application/json', 415);
        const parts = []; let length = 0;
        for await (const part of request) { length += part.length; if (length > 65536) throw new InputError('Request body too large', 413); parts.push(part); }
        try { body = JSON.parse(Buffer.concat(parts).toString() || '{}'); } catch { throw new InputError('Invalid JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('JSON body must be an object');
      }
      if (url.pathname === '/api/state' && method === 'GET') return json(response, 200, { servers: store.list('servers'), backups: store.list('backups'), jobs: store.list('jobs').slice(0, 100), recoveries: store.list('recoveries'), schedules: store.list('schedules'), timezone: config.timezone || 'Europe/Moscow', busy: jobs.active });
      if (url.pathname === '/api/servers' && method === 'POST') {
        const server = store.put('servers', { ...validateServer(body), createdAt: new Date().toISOString(), inventory: null });
        return json(response, 201, server);
      }
      const route = url.pathname.match(/^\/api\/servers\/([a-zA-Z0-9-]+)\/(discover|deploy|backup|recover|schedule)$/);
      if (route && method === 'POST') {
        const server = store.get('servers', route[1]);
        if (!server) throw new InputError('Server not found', 404);
        const action = route[2];
        if (action === 'schedule') {
          const current = store.get('schedules', server.id);
          if (body.enabled === false) return json(response, 200, store.put('schedules', { ...(current || {}), id: server.id, serverId: server.id, enabled: false }));
          if (body.confirmDowntime !== true || !server.inventory) throw new InputError('Discover the server and confirm downtime before scheduling');
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time || '')) throw new InputError('Daily time must use HH:mm');
          const policy = store.put('schedules', { id: server.id, serverId: server.id, enabled: true, time: body.time, paths: validateProjectPaths(body.paths), healthChecks: validateHealthChecks(body.healthChecks || []), lastDate: current?.lastDate });
          return json(response, 200, policy);
        }
        let operation;
        if (action === 'discover') operation = async event => {
          event('Connecting with strict SSH host-key verification');
          const inventory = await runRemote(server, { action: 'discover' });
          store.put('servers', { ...server, inventory });
          event('Ubuntu and Docker inventory collected');
          return { containers: inventory.containers.length, projects: inventory.projects.length };
        };
        else if (operations[action]) operation = operations[action](server, body);
        else throw new InputError('Operation not implemented yet', 501);
        return json(response, 202, jobs.start(action, server.id, operation));
      }
      throw new InputError('Not found', 404);
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'Operation failed; check control-plane configuration' });
      else response.end();
    }
  });
}
