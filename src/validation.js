import { isAbsolute } from 'node:path';
export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function validateServer(input) {
  const name = String(input.name || '').trim();
  const host = String(input.host || '').trim();
  const user = String(input.user || 'root').trim();
  const port = Number(input.port || 22);
  const keyPath = String(input.keyPath || '').trim();
  if (!name || name.length > 80) throw new InputError('Name must contain 1–80 characters');
  if (!/^(?:[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}|[a-fA-F0-9:]+)$/.test(host) || host.includes('..')) throw new InputError('Invalid hostname or IP address');
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(user)) throw new InputError('Invalid SSH user');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new InputError('Invalid SSH port');
  if (!isAbsolute(keyPath) || /[\r\n\0]/.test(keyPath)) throw new InputError('SSH key must use an absolute local file path');
  return { name, host, user, port, keyPath };
}
export function validateProjectPaths(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 20) throw new InputError('Select 1–20 Compose project directories');
  return [...new Set(paths.map(path => {
    if (typeof path !== 'string' || !/^\/(?:opt|srv|home)\/[a-zA-Z0-9_.\/-]+$/.test(path) || path.split('/').includes('..')) throw new InputError('Project directories must be below /opt, /srv or /home');
    return path.replace(/\/$/, '');
  }))];
}
export function validateHealthChecks(checks) {
  if (!Array.isArray(checks) || checks.length > 20) throw new InputError('Expected at most 20 health checks');
  return checks.map(check => {
    let url;
    try { url = new URL(check.url); } catch { throw new InputError('Invalid healthcheck URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new InputError('Health checks require HTTP(S) URLs without credentials');
    // Checks execute on the recovery target and must exercise that target, not production.
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new InputError('Recovery health checks must point to target localhost');
    const status = Number(check.status || 200);
    if (!Number.isInteger(status) || status < 200 || status > 399) throw new InputError('Invalid expected HTTP status');
    return { url: url.href, status };
  });
}
