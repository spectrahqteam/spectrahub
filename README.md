# SpectraHub

**Self-hosted, open-source command center for your own VPS.**
Talk to your agents in one place, browse the server, watch it, keep every decision there.

SpectraHub runs on a single small VPS. No SaaS, no telemetry, no external account required.

> Status: **0.3.1, in active development.** It installs and runs; much of the command center
> works, some is still missing — see [docs/ROADMAP.md](docs/ROADMAP.md). Not production-ready.

## What it does today

- **Chat with your agents** — Claude Code, Codex, OpenClaw and DeepSeek Harness (DSH/Hermes),
  found on the server by a scanner. Several agents in one conversation, each keeping its own
  runtime session; replies stream with their steps, diffs, tokens and cost.
- **Permissions and sign-in per agent** — read, write in the working folder, or full; Claude
  Code, Codex and DSH relay native permission requests. OpenClaw asks for an explicit
  turn scope, then relays native exec requests; integrations within that scope can act.
  Subscription, API key, or the key once the plan's limit runs out.
- **Models** as each runtime offers them, read from the runtime itself.
- **Polls** — a question with options; each agent picks one and says why.
- **Files** — the whole server, read only (secrets only after a second confirmation), and each
  agent's own files (instructions, identity, config, skills, memory) to view, edit with a
  history of versions, and hand to a conversation.
- **GitHub and Gmail**, read only, with your own tokens or app passwords.
- **Servers** — local and multiple SSH hosts, disk, memory, load, uptime and service status.
- **Real terminals** — PTY, interactive programs, resize and control keys, after explicit shell approval.
- **Agents beside the terminal** — choose available runtimes to explain output and propose
  commands. Sharing visible terminal text is optional and previewed before sending to the
  selected agents and their model providers. Prepare or copy a command; insertion never sends Enter.
- **Recoverable conversations** — HTTP restarts reattach to the same worker, including pending
  approvals; interrupted work is never automatically executed a second time.

## Principles

1. **You own the machine.** One VPS, one directory (`~/.spectrahub`), plain files for state.
2. **Your agents stay yours.** SpectraHub drives them as they are set up and never rewrites
   their configuration; anything it adds (a model, a limit) is handed over for one run.
3. **Secrets stay on the server.** Keys and tokens are never sent to the browser.
4. **Local first.** No cloud dependency in the default path.
5. **Readable over clever.** Plain HTML/CSS/JS, a small Node backend, and a locally served terminal renderer.

## Install

Requires Linux, Node.js 20+, Python 3 and an OpenSSH client. Remote monitoring needs Python 3 on the SSH host too.

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
bin/          the `spectrahub` CLI and Python PTY bridge
src/          server, private conversation workers, runtime adapters, hosts and PTY
web/          the app in the browser: start screen, chat, files, terminal, settings
test/         `npm test`
docs/         install, architecture, roadmap, decisions
```

The repository holds the product only. Installation state — agents, sign-ins, sessions,
files and settings — is stored on the server in `~/.spectrahub` and excluded from the repository.
Agent requests use the selected runtime's configured model provider; prompts and any explicitly
shared terminal context are sent there. Helper conversations remain available in the chat history.

## License

MIT — see [LICENSE](LICENSE).

## Polish / po polsku

SpectraHub to samodzielnie hostowane centrum dowodzenia na własnym VPS: rozmowy z agentami,
pliki, serwer, GitHub i Gmail — wszystko w jednym miejscu, bez chmury. Kod jest otwarty,
każdy może go pobrać i postawić u siebie.
