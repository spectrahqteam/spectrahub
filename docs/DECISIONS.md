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
