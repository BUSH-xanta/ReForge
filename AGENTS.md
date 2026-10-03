# ReForge

This repository is a VPS recovery control plane, not a Telegram task bot.
Keep changes in focused commits. Never commit credentials, backups, data or private keys.
Run `npm test` and `npm run check` before pushing.
Recovery evidence must reference an exact backup and target, and include actual health checks.
Do not invent readiness percentages or recovery durations. Unknown values stay unknown.
Production mutations must have explicit user intent and a persisted job record.
