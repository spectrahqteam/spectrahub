# Roadmap

## 0.1.0 — scaffold (current)
- [x] repository, license, principles
- [x] static shell with the launcher screen (`web/`)
- [ ] screenshots in README

## 0.2.0 — shell that runs (done)
- [x] Node server serving `web/` + `/health`
- [x] install path: `npm i -g`, `spectrahub init`, `spectrahub service install`
- [x] smoke tests + CI on Node 20/22
- [ ] SQLite bootstrap, owner account

## 0.3.0 — terminal and chat (brief: `docs/BRIEF-terminal-chat.md`)
- [x] read-only terminal: exact command allowlist, SSE stream, Ubuntu-like prompt, owner token
- [x] workspace: rail + panel + window (rail fixed on phones, panel slides over)
- [x] agent scanner (Claude Code, Codex, OpenClaw, DeepSeek Harness) — PATH, running systemd units, install folders
- [x] "start sesja": pick agents, each gets a new runtime session, one shared conversation
- [x] chat in the terminal window: `@agent` picks and keeps the recipient, `@all`, `/stop`, streamed replies
- [x] live view of the work: every tool with its output and exit code, diffs, thinking, plan, tokens and cost
- [ ] inline approval cards (TAK / NIE in the stream)
- [ ] tabs, one session per tab, drafts kept per tab
- [ ] runtime adapters: at least one working end-to-end
- [ ] approval cards

## 0.4.0 — files
- [ ] terminal session per host (PTY), commands beyond the read-only list behind approvals
- [ ] file tree + preview with allowlist/denylist
- [ ] GitHub panel (read-only: repos, branches, PR list)

## 0.5.0 — servers
- [ ] host cards, disk/RAM/uptime, service states
- [ ] map view

## Later
- automations and reports
- plugin system (declarative, no arbitrary code)
- multi-host
