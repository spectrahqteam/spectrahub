# SpectraHub

**Self-hosted, open-source command center for your own VPS.**
Talk to your agents in one place, browse the server, watch it, keep every decision there.

SpectraHub runs on a single small VPS. No SaaS, no telemetry, no external account required.

> Status: **0.2.0, in active development.** It installs and runs; much of the command center
> works, some is still missing — see [docs/ROADMAP.md](docs/ROADMAP.md). Not production-ready.

## What it does today

- **Chat with your agents** — Claude Code, Codex, OpenClaw and DeepSeek Harness (DSH/Hermes),
  found on the server by a scanner. Several agents in one conversation, each keeping its own
  runtime session; replies stream with their steps, diffs, tokens and cost.
- **Permissions and sign-in per agent** — read, write in the working folder, or full; Claude
  Code asks in the chat for anything beyond its level (allow once, for the session, or deny).
  Subscription, API key, or the key once the plan's limit runs out.
- **Models** as each runtime offers them, read from the runtime itself.
- **Polls** — a question with options; each agent picks one and says why.
- **Files** — the whole server, read only (secrets only after a second confirmation), and each
  agent's own files (instructions, identity, config, skills, memory) to view, edit with a
  history of versions, and hand to a conversation.
- **GitHub and Gmail**, read only, with your own tokens or app passwords.
- **Server** — disk, memory, load and uptime; a terminal limited to a list of safe commands.

## Principles

1. **You own the machine.** One VPS, one directory (`~/.spectrahub`), plain files for state.
2. **Your agents stay yours.** SpectraHub drives them as they are set up and never rewrites
   their configuration; anything it adds (a model, a limit) is handed over for one run.
3. **Secrets stay on the server.** Keys and tokens are never sent to the browser.
4. **Local first.** No cloud dependency in the default path.
5. **Readable over clever.** Plain HTML/CSS/JS, a small Node backend, no dependencies.

## Install

Requires Node.js 20 or newer, on Linux.

```bash
npm install -g github:spectrahqteam/spectrahub
spectrahub init
spectrahub service install
```

`init` prints a one-time login link. SpectraHub listens on `127.0.0.1:8787`; put nginx or
Caddy in front of it for HTTPS. Full guide: [docs/INSTALL.md](docs/INSTALL.md).

```bash
spectrahub doctor    # checks the install, fails loudly
```

## Repository layout

```
bin/          the `spectrahub` command: init, serve, service, login, doctor
src/          server: agents, sessions, files, GitHub, Gmail, usage — no dependencies
web/          the app in the browser: start screen, chat, files, terminal, settings
test/         `npm test`
docs/         install, architecture, roadmap, decisions
```

The repository holds the product only. Everything SpectraHub learns about a server — its agents,
sign-ins, sessions, files and settings — stays on that server, in `~/.spectrahub`.

## License

MIT — see [LICENSE](LICENSE).

## Polish / po polsku

SpectraHub to samodzielnie hostowane centrum dowodzenia na własnym VPS: rozmowy z agentami,
pliki, serwer, GitHub i Gmail — wszystko w jednym miejscu, bez chmury. Kod jest otwarty,
każdy może go pobrać i postawić u siebie.
