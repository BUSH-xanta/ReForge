# Architecture

Node.js HTTP API and static web UI, SQLite registry, in-process background jobs, OpenSSH transport and small Python 3 remote operations. SQLite WAL persists job status and events; unfinished jobs are failed after restart, never silently replayed.

## Trust boundaries

All API routes except liveness require the owner token. Mutations reject cross-origin browser requests. SSH uses BatchMode, IdentitiesOnly and StrictHostKeyChecking. No shell interpolation of user-supplied scripts. SSH key files and known_hosts are operator-managed. API errors and inventory must not reveal container environment values.

## Recovery contract

A manifest describes selected Compose projects, images and volumes. A snapshot is encrypted at rest with AES-256-GCM. Source services are stopped briefly for consistent cold volume capture, then restarted even if capture fails. This downtime must be explicit in the UI. An archive that fails authentication cannot be restored.

A recovery test runs on a separate explicitly confirmed empty target. Existing Compose workloads or restoration files cause refusal. A passing proof requires all declared HTTP checks and healthy/running restored services. A backup with no application checks cannot be marked verified. Recovery duration is measured from the job, never estimated from an arbitrary score.

Supported coverage must be disclosed. Bind mounts outside the project directory, host services, external volumes, external DBs and DNS are excluded and must block an unqualified recovery proof.
