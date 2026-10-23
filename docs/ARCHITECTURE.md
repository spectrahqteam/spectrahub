# Architecture

Status: 0.2.0. This describes what runs today.

## Shape

```
browser (plain HTML/CSS/JS, no build step)
   |  HTTPS
nginx / caddy
   |  HTTP on 127.0.0.1
Node (one process, no dependencies)
   |-- ~/.spectrahub           config, owner token, sessions and projects (JSON), backups,
   |                           credentials the owner connects (0600)
   |-- agent runtimes          Claude Code, Codex, OpenClaw, DeepSeek Harness — run per turn
   |-- the server itself       files (read only), system figures, an allowlisted terminal
   '-- GitHub API, Gmail IMAP  read only, with the owner's own credentials
```

Replies reach the browser as Server-Sent Events; a reconnecting browser picks up where it was.

## Boundaries

- **Frontend** is plain HTML/CSS/JS served from `web/`. No framework, no build.
- **Backend** is one Node process with a small routing table. No framework, no database: state
  is JSON files, written through a temporary file and renamed (see D7).
- **One owner.** A token created by `spectrahub init`; devices sign in with one-time links.
- **Secrets** never reach the browser: the API returns where a key is, never its value. Files
  that look like credentials are shown only after a second confirmation and are never handed
  to a conversation.

## Runtime adapters

Each runtime is driven the way it runs on its own, and its configuration is never rewritten.

| Runtime | How a turn runs | Prompts in the chat |
| --- | --- | --- |
| Claude Code | `claude -p`, stream-json in and out, its own session id | permission prompts and questions, via `--permission-prompt-tool stdio` |
| Codex | `codex exec --json`, resumed by thread id; sandbox per permission level | none (non-interactive) |
| OpenClaw | `openclaw agent --json` through its gateway; limited levels run embedded with a config that only adds tool denials | none |
| DeepSeek Harness | `dsh --profile headless --json`; a chosen model or reasoning goes as a `--patch` overlay | none |

A runtime that is installed but not reachable is shown, not hidden.

## Permissions

Each agent in a session has a level — read, write in the working folder, or full — mapped onto
what its runtime offers. Claude Code asks in the chat for anything beyond its level; the other
runtimes enforce their level without asking. A product rule (D5) asks for approvals before every
state change; for runtimes without a prompt protocol that is not met yet (see the roadmap).

## Files

- The whole server can be browsed, read only; devices, pipes and sockets are never opened.
- Each agent's own files are found where the runtime keeps them, in every home on the server,
  plus the files its instructions point to. Edits are saved in place; the previous version goes
  to `~/.spectrahub/backups` and a newer change is never overwritten.

## Non-goals

- multi-tenant hosting
- mobile apps
- plugin marketplace with arbitrary code execution
