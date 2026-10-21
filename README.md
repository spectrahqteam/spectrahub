# SpectraHub

**Self-hosted, open-source command center for your own VPS.**
Chat with agents, run a terminal, browse files, watch servers, keep every decision in one place.

SpectraHub runs on a single small VPS. No SaaS, no telemetry, no external account required.

> Status: **early scaffold (0.1.0)**. The repository is real; most modules are still design.
> Nothing here is production-ready yet — see [docs/ROADMAP.md](docs/ROADMAP.md).

## Why

Most "AI dashboards" are hosted products that hold your keys. SpectraHub is the opposite:
you install it on hardware you own, it talks to the runtimes you already run (Claude Code,
Codex, OpenClaw, DSH/Hermes), and every state-changing action asks you first.

## Principles

1. **You own the machine.** One VPS, one directory, SQLite for state.
2. **Nothing changes without consent.** Destructive actions are gated by an explicit approval.
3. **Local first.** No cloud dependency in the default path.
4. **Readable over clever.** Plain HTML/CSS/JS frontend, small Node backend, no framework lock-in.
5. **Tool names, not people names.** The UI speaks about runtimes, not about teammates.

## Quick start (will work once 0.2.0 lands)

```bash
git clone https://github.com/spectrahqteam/spectrahub.git
cd spectrahub
# no build step for the shell, see docs/ARCHITECTURE.md
```

## Repository layout

```
web/          static shell (no dependencies, opens in a browser)
docs/         architecture, roadmap, decisions
PROJECT_STATE.md  current state of work
```

## License

MIT — see [LICENSE](LICENSE).

## Polish / po polsku

SpectraHub to samodzielnie hostowane centrum dowodzenia na własnym VPS: rozmowy z agentami,
terminal, pliki, serwery i zgody — wszystko w jednym miejscu, bez chmury. Kod jest otwarty,
każdy może go pobrać i postawić u siebie.
