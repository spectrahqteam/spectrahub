# Architecture

Status: design, 0.1.0. Nothing below is implemented yet except `web/`.

## Shape

```
browser (static shell, no build step)
   |
   v
nginx / caddy  ---- TLS
   |
   v
Node API (small, single process)  -->  SQLite (state: chats, approvals, sessions)
   |
   +--> local runtime adapters (claude / codex / openclaw / dsh)
   +--> read-only file views (allowlist, denylist)
```

## Boundaries

- **Frontend** is plain HTML/CSS/JS. It must open from the filesystem for design work.
- **Backend** is one Node process with a tiny routing table. No framework.
- **State** lives in SQLite in WAL mode. One owner account, no signup.
- **Secrets** never reach the browser. The API returns paths and status, never values.

## Approval model

Any action that changes the machine (write file, restart service, deploy, spend) creates an
approval record. The UI shows it as a pending card; nothing executes until the owner confirms.
Approvals are append-only and auditable.

## Runtime adapters

A runtime is anything that can accept a prompt and stream output: Claude Code, Codex, OpenClaw,
DSH/Hermes. Adapters expose the same three calls: `available()`, `send(prompt)`, `stream()`.
A missing runtime is shown as a red dot, not as an error page.

## File access

- allowlist of roots
- allowlist of extensions for preview
- hard denylist (`.env`, keys, certificates) — never returned, covered by a negative test

## Non-goals

- multi-tenant hosting
- mobile apps
- plugin marketplace with arbitrary code execution
