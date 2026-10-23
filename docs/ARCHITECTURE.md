# Architecture

Version 0.3.0. Plain browser JavaScript, a Node HTTP server, private JSON state and
separate workers for agent turns. No frontend framework or database server.

```text
browser: HTML/CSS/JS + locally served xterm.js
  | HTTPS, HTTP requests and SSE
reverse proxy
  | loopback HTTP
Node server
  |-- installation directory: config, host definitions, sessions, backups
  |-- detached conversation workers: runtime protocol + private event journal
  |-- approved PTY sessions: Python standard-library bridge
  |-- SSH hosts: existing keys, strict known-host checks, read-only metrics
  '-- GitHub API / Gmail IMAP: read-only connected accounts
```

## Ownership and state

One owner signs in with a token or a one-time pairing link. Owner routes require
Bearer authentication or the HTTP-only SameSite cookie. There is no multi-tenant
role model. The process runs with the operating-system privileges of its service account.

Sessions, project groups, host definitions and worker control state are JSON files.
Session snapshots and worker cursors are committed together through a temporary file
and rename. Each worker owns its append-only journal. Direct config settings retain
the existing JSON format. Private worker directories use 0700 and files 0600.

Product source and installation data are separate. The Git tree contains public code,
synthetic tests and documentation. npm uses a file allowlist. `npm run check:release`
checks both the source list and the actual package payload before publication.

## Conversation execution and recovery

A turn reserves its agent, saves a run specification and session pointer, then launches
one detached worker. Provider credentials travel over stdin; they are not written to
the launch specification. The worker drives the runtime and journals normalized events.
The HTTP process applies events after the last saved cursor and streams them over SSE.

A restarted HTTP server attaches to the existing worker without resubmitting a prompt.
Pending requests remain actionable: answers go through a private command inbox and
acknowledgements are journaled. A process stamp protects against PID reuse. A missing
worker or incomplete launch becomes interrupted; it never triggers automatic execution.
A subsequent owner message continues the runtime session using its saved reference.

systemd must use `KillMode=process`. Worker lifetime is bounded to eight hours and its
journal to 64 MiB. A machine reboot interrupts workers; it cannot transparently resume
an in-flight external tool. HTTP shutdown closes PTY sessions but leaves agent workers.

## Runtime protocols and approvals

| Runtime | Transport | Approval behavior |
| --- | --- | --- |
| Claude Code | stream JSON, native control requests | tool requests and questions where supported; older versions require a turn-scope grant |
| Codex | app-server JSON-RPC | native command, file-access and user-input requests; starts read-only |
| DeepSeek Harness | ACP through a temporary transport overlay | native one-shot tool permissions; installed profile retained |
| OpenClaw, full | ACP to its gateway | explicit one-turn scope grant, then native exec permission requests |
| OpenClaw, read/write | embedded invocation with added tool denials | shell disabled; write scope requires one-turn approval |

Read-only sessions reject permission escalation. Unknown native requests fail closed;
no failed native transport falls back to an unrestricted CLI. The card distinguishes a
one-shot tool decision from a native access grant lasting for the current turn.
OpenClaw gateway integrations do not all expose per-tool approvals: the full-turn card
explicitly authorizes that wider scope. It is not presented as approval of every action.
The owner's global runtime configuration is not rewritten. OpenClaw exec settings apply
only to the dedicated conversation's gateway session.

Native approvals cover the operations exposed by the installed runtime. They are not
a universal interception layer for arbitrary external MCP or plugin side effects.

The scanner reports capability and availability. A runtime that cannot speak the
required protocol reports an error instead of silently bypassing approval.

## Terminals and remote hosts

A terminal request is pending until a separate owner approval. After approval, a Python
POSIX PTY bridge runs the shell with window size and signal handling. xterm.js renders
its byte stream. Input and resize use authenticated HTTP; output uses SSE with bounded
replay and slow-reader disconnection. Browser reconnects reuse the same shell. A terminal
grant covers the whole interactive shell until closed, not individual keystrokes.

There are at most eight active terminals per installation. Idle timeout defaults to
30 minutes. HTTP server shutdown closes shells; durable recovery applies to agent turns.

Remote hosts use OpenSSH argv, never interpolated local shell commands. The UI stores
host metadata and identity-file paths, not private keys. Batch authentication and strict
host-key checking are mandatory. Monitoring runs a fixed Python read-only collector;
service names and connection parameters are validated. Remote interactive shells use SSH
TTY allocation. Host changes invalidate a pending terminal approval.

## Files and integrations

The server filesystem is browsable read-only; special devices, sockets and pipes are
refused. Secret-looking paths and symlink targets require explicit reveal and are not
conversation attachments. Agent-owned file edits keep backups and reject stale versions.
GitHub and Gmail integrations are read-only and use the owner's own server-side credentials.

## Remaining limits

No automatic replay after a machine reboot, multi-tenant hosting, remote agent-runtime
installation, or arbitrary plugin marketplace. Multiple hosts currently cover monitoring
and terminals; agent discovery and the filesystem browser belong to the local server.
