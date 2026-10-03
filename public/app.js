const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = value => value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Ещё нет';
const bytes = value => value < 1024 ** 2 ? Math.round(value / 1024) + ' KB' : value < 1024 ** 3 ? (value / 1024 ** 2).toFixed(1) + ' MB' : (value / 1024 ** 3).toFixed(2) + ' GB';
const names = { overview: ['Recovery overview', 'Знай, что работает. Докажи, что восстановится.'], servers: ['Your servers', 'SSH, сервисы и состояние каждого VPS.'], backups: ['Recovery backups', 'Зашифрованные снимки выбранных Compose-проектов.'], recovery: ['Recovery evidence', 'Фактическое восстановление и результаты проверок.'], activity: ['Operation history', 'Каждая операция оставляет проверяемую историю.'] };
let token = sessionStorage.getItem('reforge.token') || '';
let state = { servers: [], backups: [], jobs: [], recoveries: [], busy: false };
let view = 'overview', refreshing = false;
async function api(path, body) {
  const response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) { token = ''; sessionStorage.removeItem('reforge.token'); if (!$('#login').open) $('#login').showModal(); }
    throw new Error(result.error || 'Запрос не выполнен');
  }
  return result;
}
function message(text) { $('#message').textContent = text; $('#message').hidden = false; }
async function refresh() {
  if (!token || refreshing) return;
  refreshing = true;
  try { state = await api('state'); $('#connection').textContent = state.busy ? 'Operation running' : 'Control plane online'; render(); }
  catch (error) { message(error.message); $('#connection').textContent = 'Connection unavailable'; }
  finally { refreshing = false; }
}
function serverName(id) { return state.servers.find(server => server.id === id)?.name || 'Unknown server'; }
function latestBackup(id) { return state.backups.find(backup => backup.serverId === id); }
function latestProof(id) { return state.recoveries.find(proof => proof.backupId === id); }
function badge(status) { const cls = ['verified', 'succeeded'].includes(status) ? '' : status === 'failed' ? 'failed' : 'unknown'; const label = { verified: '✓ VERIFIED', succeeded: '✓ DONE', failed: '× FAILED', created: 'ENCRYPTED', queued: 'QUEUED', running: 'RUNNING', untested: 'UNTESTED' }[status] || status; return '<span class="badge ' + cls + '">' + escape(label) + '</span>'; }
function metrics() {
  const verified = state.servers.filter(server => latestBackup(server.id)?.recoveryStatus === 'verified').length;
  const backupBytes = state.backups.reduce((sum, backup) => sum + backup.bytes, 0);
  const items = [
    ['Connected servers', state.servers.length, 'Подключены по SSH', '▤'],
    ['Verified recovery', verified + ' / ' + state.servers.length, 'Проверены выбранные Compose-проекты', '↻'],
    ['Recovery backups', state.backups.length, state.backups.length ? bytes(backupBytes) + ' · local encrypted' : 'Снимков пока нет', '◈'],
    ['Active operations', state.jobs.filter(job => ['queued', 'running'].includes(job.status)).length, 'Операции выполняются последовательно', '≋']
  ];
  $('#metrics').innerHTML = items.map(([label, value, note, icon]) => '<div class="metric"><div class="metric-label">' + label + '<span>' + icon + '</span></div><div class="metric-value">' + value + '</div><div class="metric-note">' + note + '</div></div>').join('');
}
function empty(title, text, action = '') { return '<div class="empty"><div class="empty-icon">↗</div><h2>' + title + '</h2><p>' + text + '</p>' + action + '</div>'; }
function cards() {
  if (!state.servers.length) return empty('Начни с первого VPS', 'Подключи Ubuntu-сервер по SSH. ReForge обнаружит Compose-проекты, создаст recovery backup и проверит восстановление на отдельном сервере.', '<button class="primary" data-action="add">＋ Подключить сервер</button>');
  return '<div class="cards">' + state.servers.map(server => {
    const backup = latestBackup(server.id), proof = backup && latestProof(backup.id);
    const inventory = server.inventory;
    return '<article class="server-card"><div class="card-header"><div><div class="server-name"><span class="server-symbol">▤</span>' + escape(server.name) + '</div><p class="server-host">' + escape(server.host) + ' · ' + escape(inventory?.os || 'Not discovered') + '</p></div>' + badge(backup?.recoveryStatus || 'untested') + '</div><div class="card-body"><div class="card-row"><span>Last backup</span><span>' + (backup ? '✓ ' + date(backup.createdAt) : '— Не создан') + '</span></div><div class="card-row"><span>Last recovery test</span><span>' + (proof ? (proof.passed ? '✓ ' : '× ') + date(proof.checkedAt) : '— Не проверено') + '</span></div><div class="card-row"><span>Discovered services</span><span>' + (inventory ? inventory.containers.length + ' containers · ' + inventory.projects.length + ' projects' : '—') + '</span></div><div class="readiness card-row"><span>Recovery readiness</span><strong class="' + (backup?.recoveryStatus === 'verified' ? 'green' : 'muted') + '">' + (backup?.recoveryStatus === 'verified' ? 'Compose проверено' : 'Не доказано') + '</strong></div><div class="card-row"><span>Measured recovery</span><span>' + (proof?.passed ? Math.ceil(proof.durationSeconds / 60) + ' min · ' + proof.durationSeconds + ' sec' : '—') + '</span></div><p class="scope-note">' + (backup ? 'Scope: selected Compose projects · ' + backup.projects.length + ' projects' : 'Подключи SSH → запусти Discover → создай backup') + '</p></div><div class="card-actions"><button data-action="backup" data-id="' + server.id + '"' + (!inventory || state.busy ? ' disabled' : '') + '>BACKUP NOW</button><button data-action="recover" data-id="' + server.id + '"' + (!backup || state.busy ? ' disabled' : '') + '>TEST RECOVERY</button><button class="view-server ghost" data-action="detail" data-id="' + server.id + '">VIEW →</button></div></article>';
  }).join('') + '</div>';
}
function jobTable(jobs) {
  if (!jobs.length) return '<div class="table-wrap"><p class="muted empty">Операций пока нет. История появится после первого Discover.</p></div>';
  return '<div class="table-wrap"><table><thead><tr><th>OPERATION</th><th>SERVER</th><th>STARTED</th><th>STATUS</th><th></th></tr></thead><tbody>' + jobs.map(job => '<tr><td class="mono">' + escape(job.type.toUpperCase()) + '</td><td>' + escape(serverName(job.serverId)) + '</td><td class="muted">' + date(job.createdAt) + '</td><td>' + badge(job.status) + '</td><td><button data-action="job" data-id="' + job.id + '">LOG →</button></td></tr>').join('') + '</tbody></table></div>';
}
function render() {
  $('#nav-count').textContent = state.servers.length;
  $('#page-title').textContent = names[view][0]; $('#page-description').textContent = names[view][1]; $('#breadcrumb').textContent = view === 'overview' ? 'Overview' : names[view][0];
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  metrics();
  let content = '';
  if (view === 'overview' || view === 'servers') {
    content = '<div class="section-heading"><h2>Server fleet</h2><span>' + state.servers.length + ' connected · Live data</span></div>' + cards();
    if (view === 'overview') content += '<section class="activity-panel"><div class="section-heading"><h2>Recent activity</h2><span>Последние операции</span></div>' + jobTable(state.jobs.slice(0, 5)) + '</section>';
  } else if (view === 'backups') {
    content = state.backups.length ? '<div class="table-wrap"><table><thead><tr><th>SERVER / SNAPSHOT</th><th>CREATED</th><th>SIZE</th><th>RECOVERY</th><th></th></tr></thead><tbody>' + state.backups.map(backup => '<tr><td>' + escape(serverName(backup.serverId)) + '<br><small class="muted mono">' + backup.id.slice(0, 8) + ' · ' + backup.projects.length + ' projects</small></td><td>' + date(backup.createdAt) + '</td><td>' + bytes(backup.bytes) + '</td><td>' + badge(backup.recoveryStatus) + '</td><td><button data-action="manifest" data-id="' + backup.id + '">MANIFEST →</button></td></tr>').join('') + '</tbody></table></div>' : empty('Backup ещё не создан', 'Открой карточку сервера, запусти Discover и выбери Compose-проекты для сохранения.');
  } else if (view === 'recovery') {
    content = state.recoveries.length ? state.recoveries.map(proof => '<article class="proof-card"><div class="section-heading"><h3>' + escape(serverName(proof.serverId)) + ' ← Backup ' + proof.backupId.slice(0, 8) + '</h3>' + badge(proof.passed ? 'verified' : 'failed') + '</div><p class="muted">' + date(proof.checkedAt) + ' · ' + proof.durationSeconds + ' sec · selected Compose projects</p>' + proof.services.map(service => '<div class="proof-check"><span>' + escape(service.name) + '</span><span class="' + (service.passed ? 'green' : 'error') + '">' + escape(service.state) + ' · ' + escape(service.health || 'no Docker healthcheck') + '</span></div>').join('') + proof.checks.map(check => '<div class="proof-check"><span>' + escape(check.url) + '</span><span class="' + (check.passed ? 'green' : 'error') + '">' + (check.passed ? '✓' : '×') + ' HTTP ' + escape(check.actual ?? 'unreachable') + ' / expected ' + check.expected + '</span></div>').join('') + (proof.warnings.length ? '<ul class="warning-list">' + proof.warnings.map(warning => '<li>' + escape(warning) + '</li>').join('') + '</ul>' : '') + '</article>').join('') : empty('Восстановление ещё не доказано', 'Подключи отдельный пустой VPS, подготовь Ubuntu и запусти Test Recovery. Здесь появятся реальные результаты проверок.');
  } else content = jobTable(state.jobs);
  $('#view').innerHTML = content;
}
function modal(title, content) { $('#modal-heading').textContent = title; $('#modal-content').innerHTML = content; $('#modal').showModal(); }
function formError(form, text) { form.querySelector('[role="alert"]').textContent = text; }
function bindForm(handler) {
  const form = $('#operation-form');
  form.addEventListener('submit', async event => {
    event.preventDefault(); const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try { await handler(new FormData(form), form); $('#modal').close(); message('Операция запущена. Результат и журнал появятся в Activity.'); await refresh(); }
    catch (error) { formError(form, error.message); }
    finally { submit.disabled = false; }
  });
}
const actions = '<p class="error" role="alert"></p><div class="form-actions"><button type="submit" class="primary">Запустить →</button></div>';
function addServer() {
  modal('Подключить VPS', '<form id="operation-form"><p class="muted">Доступ по SSH-ключу. Сервер должен быть заранее добавлен в known_hosts; пользователю нужен root или sudo без пароля.</p><label>Название<input name="name" placeholder="DE-01" maxlength="80" required></label><label>IP / hostname<input name="host" placeholder="203.0.113.10" required></label><div class="form-row"><label>SSH user<input name="user" value="root" required></label><label>SSH port<input name="port" type="number" min="1" max="65535" value="22" required></label></div><label>Путь к ключу на машине ReForge<input name="keyPath" placeholder="/home/operator/.ssh/id_ed25519" required></label><p class="muted">Windows: C:\\Users\\you\\.ssh\\id_ed25519. Приватный ключ не загружается через браузер.</p>' + actions + '</form>');
  bindForm(async data => { await api('servers', { ...Object.fromEntries(data), port: Number(data.get('port')) }); });
}
function backupDialog(id) {
  const server = state.servers.find(item => item.id === id);
  const projects = server.inventory?.projects || [];
  if (!projects.length) { message('Compose-проекты не найдены. Сначала запусти Discover и проверь Docker на сервере.'); return; }
  modal('Backup · ' + server.name, '<form id="operation-form"><p class="muted">Сохраняются файлы проекта, .env, named volumes и дампы обнаруженных PostgreSQL/MySQL. Образы фиксируются по registry digest.</p>' + projects.map(project => '<label class="check-label"><input type="checkbox" name="paths" value="' + escape(project.path) + '" checked><span>' + escape(project.name) + '<span class="project-path">' + escape(project.path) + '</span></span></label>').join('') + '<label>Healthcheck после восстановления — по одному URL в строке<textarea name="checks" placeholder="http://127.0.0.1:8080/health"></textarea></label><p class="muted">Ожидается HTTP 200 с целевого localhost. Без этих проверок backup останется untested.</p><div class="notice">Cold snapshot: выбранные контейнеры ненадолго остановятся. Внешние bind mounts, external volumes и locally built images пока не поддерживаются.</div><label class="check-label"><input type="checkbox" name="downtime" required><span>Подтверждаю остановку выбранных сервисов на время снимка.</span></label><label class="check-label"><input type="checkbox" name="daily"><span>Повторять backup ежедневно в 03:00 (' + escape(state.timezone || 'Europe/Moscow') + '). Подтверждаю такую же остановку сервисов при автоматических backup.</span></label>' + actions + '</form>');
  bindForm(async data => { const body = { paths: data.getAll('paths'), healthChecks: String(data.get('checks')).split('\n').map(line => line.trim()).filter(Boolean).map(url => ({ url, status: 200 })), confirmDowntime: data.has('downtime') }; await api('servers/' + id + '/backup', body); if (data.has('daily')) await api('servers/' + id + '/schedule', { ...body, enabled: true, time: '03:00' }); });
}
function recoveryDialog(id) {
  const source = state.servers.find(item => item.id === id), backups = state.backups.filter(backup => backup.serverId === id);
  const targets = state.servers.filter(server => server.id !== id);
  if (!targets.length) { message('Для recovery test подключи отдельный пустой Ubuntu VPS. Исходный сервер использовать нельзя.'); return; }
  modal('Test recovery · ' + source.name, '<form id="operation-form"><div class="notice">Целевой VPS должен быть пустым, с установленными Docker и Compose. Восстановление создаст файлы и запустит сервисы; они останутся на VPS после проверки.</div><label>Backup<select name="backupId">' + backups.map(backup => '<option value="' + backup.id + '">' + date(backup.createdAt) + ' · ' + backup.id.slice(0, 8) + ' · ' + bytes(backup.bytes) + '</option>').join('') + '</select></label><label>Recovery target<select name="targetId">' + targets.map(server => '<option value="' + server.id + '">' + escape(server.name) + ' · ' + escape(server.host) + '</option>').join('') + '</select></label><label>Введи название целевого сервера<input name="confirm" autocomplete="off" required></label>' + actions + '</form>');
  bindForm(async data => api('servers/' + data.get('targetId') + '/recover', { backupId: data.get('backupId'), confirm: data.get('confirm') }));
}
function deployDialog(server) {
  modal('Deploy · ' + server.name, '<form id="operation-form"><div class="notice">Поддерживается Ubuntu 24.04. Устанавливаются Docker/Compose, UFW и fail2ban. Отключается вход по SSH-паролю, ключевой вход root сохраняется. SSH-порт разрешается перед включением firewall.</div><label>Дополнительные открытые TCP-порты<input name="ports" placeholder="80, 443"></label><p class="muted">Укажи все публичные порты твоих сервисов. Существующие правила UFW сохраняются.</p><label>Введи название сервера<input name="confirm" required autocomplete="off"></label>' + actions + '</form>');
  bindForm(async data => api('servers/' + server.id + '/deploy', { confirm: data.get('confirm'), allowedPorts: String(data.get('ports')).split(',').map(value => value.trim()).filter(Boolean).map(Number) }));
}
function detailDialog(id) {
  const server = state.servers.find(item => item.id === id), inventory = server.inventory;
  modal('Server · ' + server.name, '<p class="mono muted">' + escape(server.user + '@' + server.host + ':' + server.port) + '</p><div class="form-actions"><button data-action="discover" data-id="' + id + '"' + (state.busy ? ' disabled' : '') + '>DISCOVER</button><button data-action="deploy" data-id="' + id + '"' + (state.busy ? ' disabled' : '') + '>DEPLOY UBUNTU</button></div>' + (state.schedules?.find(policy => policy.serverId === id && policy.enabled) ? '<div class="notice">Daily backup: 03:00 ' + escape(state.timezone) + '<br><button data-action="disable-schedule" data-id="' + id + '">Отключить расписание</button></div>' : '') + (inventory ? '<div class="detail"><h3>System</h3><p class="muted">' + escape(inventory.os) + ' · ' + escape(inventory.kernel) + '<br>Docker: ' + inventory.docker + ' · Compose: ' + inventory.compose + ' · BBR: ' + escape(inventory.bbr) + '<br>Inventory: ' + date(inventory.collectedAt) + '</p></div><div class="detail"><h3>Services</h3>' + inventory.containers.map(container => '<p>' + escape(container.name) + ' <small class="muted">' + escape(container.state + ' · ' + container.image) + (container.database ? ' · ' + escape(container.database) : '') + '</small></p>').join('') + '</div><div class="detail"><h3>Volumes / ports / domains</h3><pre id="inventory-detail"></pre></div>' + (inventory.warnings.length ? '<ul class="warning-list">' + inventory.warnings.map(warning => '<li>' + escape(warning) + '</li>').join('') + '</ul>' : '') : '<p class="muted">Инвентаризация ещё не запускалась. Нажми Discover.</p>'));
  if (inventory) $('#inventory-detail').textContent = JSON.stringify({ volumes: inventory.volumes, services: inventory.containers.map(container => ({ name: container.name, ports: container.ports, domains: container.domains, mounts: container.mounts })), hostDatabases: inventory.hostDatabases }, null, 2);
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action], [data-view]');
  if (!button) return;
  if (button.dataset.view) { view = button.dataset.view; render(); return; }
  const { action, id } = button.dataset;
  try {
    if (action === 'add') addServer();
    if (action === 'detail') detailDialog(id);
    if (action === 'backup') backupDialog(id);
    if (action === 'recover') recoveryDialog(id);
    if (action === 'deploy') { $('#modal').close(); deployDialog(state.servers.find(server => server.id === id)); }
    if (action === 'disable-schedule') { await api('servers/' + id + '/schedule', { enabled: false }); $('#modal').close(); message('Автоматические backup отключены.'); await refresh(); }
    if (action === 'discover') { await api('servers/' + id + '/discover', {}); $('#modal').close(); message('Discover запущен. Следи за журналом в Activity.'); await refresh(); }
    if (action === 'manifest') { modal('Recovery manifest · ' + id.slice(0, 8), '<p class="muted">Публичная сводка. Полный manifest с Compose-конфигурацией находится внутри зашифрованного архива.</p><pre id="manifest-data"></pre>'); $('#manifest-data').textContent = JSON.stringify(state.backups.find(backup => backup.id === id), null, 2); }
    if (action === 'job') { const job = state.jobs.find(item => item.id === id); modal(job.type.toUpperCase() + ' · ' + serverName(job.serverId), '<p>' + badge(job.status) + '</p><pre id="job-log"></pre>'); $('#job-log').textContent = job.events.map(item => date(item.at) + '  ' + item.message).join('\n') + (job.error ? '\n\nERROR: ' + job.error : '') + (job.result ? '\n\n' + JSON.stringify(job.result, null, 2) : ''); }
  } catch (error) { message(error.message); }
});
$('#add-server').addEventListener('click', addServer);
$('#close-modal').addEventListener('click', () => $('#modal').close());
$('#signout').addEventListener('click', () => { token = ''; sessionStorage.removeItem('reforge.token'); $('#owner-token').value = ''; $('#login').showModal(); });
$('#login').addEventListener('cancel', event => event.preventDefault());
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); token = $('#owner-token').value.trim();
  try { state = await api('state'); sessionStorage.setItem('reforge.token', token); $('#login').close(); $('#login-error').textContent = ''; $('#owner-token').value = ''; render(); }
  catch (error) { $('#login-error').textContent = error.message; }
});
render();
if (token) await refresh(); else $('#login').showModal();
setInterval(refresh, 4000);

