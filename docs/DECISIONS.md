# Decisions

## D1 — Public repository, MIT (2026-10-21)
SpectraHub is meant to be installed by anyone on their own VPS, so the code is public from the
first commit. MIT keeps adoption friction low; the license can be revisited before 1.0 while
the project is still a scaffold.

## D2 — Name: SpectraHub (repo) / Spectra Studio (brand inside the product)
Repository and install path use `spectrahub`. The visual brand inside the UI may still read
"SPECTRA STUDIO" while the Studio module lives here. Not final — revisit before 0.3.0.

## D3 — No frontend framework
Plain HTML/CSS/JS. The shell must open straight from the filesystem for design work, without a
build step, and must stay readable for contributors.

## D4 — Node + SQLite backend, single process
One small Node process, SQLite in WAL mode for state. No ORM, no framework, no external queue.

## D5 — Approvals before state change
Any action that changes the machine creates an approval record and waits for the owner. This is
a product rule, not a configuration option.

## D6 — UI names runtimes, never people
Screens talk about Terminal, Chat, Servers, Files, GitHub — and about runtimes (Claude Code,
Codex, OpenClaw, DSH). Personal names of team members never appear in the UI.

## D7 — State in plain files, not SQLite (2026-10-23)
Supersedes the storage half of D4. Sessions, projects and settings are JSON files under
`~/.spectrahub` (written through a temporary file and renamed); credentials the owner connects
(API keys, GitHub tokens, Gmail app passwords) sit next to them with mode 0600. Readable,
easy to back up, no database to run. Still one Node process, no framework.

## D8 — Native permissions and explicit scope (2026-10-23)
Codex uses app-server and DSH uses ACP so the owner can answer real runtime requests.
Unsupported native operations fail closed. Cards name one-shot versus turn-scope access.
OpenClaw full turns need an explicit scope
grant because its gateway does not offer per-tool approval for every integration;
exec requests are relayed separately. An interactive terminal likewise has a visible
shell-lifetime grant. These explicit scoped grants clarify D5: a grant authorizes the
stated scope, not an implied sequence of individually reviewed actions.

## D9 — Detached workers and replay of events, not actions (2026-10-23)
Each conversation turn owns a private worker journal. HTTP restarts reconnect to that
worker. A killed worker or reboot is reported as interrupted; the original prompt is
never automatically executed again. systemd KillMode=process preserves workers across
HTTP restarts. Existing state stays compatible JSON.

## D10 — PTY and terminal renderer (2026-10-23)
A Python 3 standard-library bridge supplies a real POSIX terminal. The browser uses
xterm.js and its fit addon, installed and served locally. This adds two pinned browser
packages and a Python runtime requirement, while retaining the framework-free frontend
and Node backend. SSH uses the host's existing identity and strict known-host checking.
