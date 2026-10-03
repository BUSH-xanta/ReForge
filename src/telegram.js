export function telegramNotifier(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN, chatId = env.TELEGRAM_CHAT_ID;
  if (!token && !chatId) return async () => {};
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token || '') || !/^-?\d+$/.test(chatId || '')) throw new Error('Invalid Telegram bot token or chat id');
  return async job => {
    const status = job.status === 'succeeded' ? '✓' : '×';
    const text = ['ReForge ' + status + ' ' + job.type.toUpperCase(), 'Job: ' + job.id, 'Server: ' + job.serverId, 'Status: ' + job.status, job.type === 'recover' && job.status === 'succeeded' ? 'Selected Compose projects restored; application health checks passed.' : 'Details are available in ReForge Activity.'].join('\n');
    const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }), signal: AbortSignal.timeout(15000) });
    if (!response.ok || !(await response.json()).ok) throw new Error('Telegram delivery failed');
  };
}
