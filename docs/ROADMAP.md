# Roadmap

## 0.3.0 — interactive operations and recoverable conversations

- [x] CLI installation, owner sign-in, systemd service and health check
- [x] Shared conversations with Claude Code, Codex, OpenClaw and DeepSeek Harness
- [x] Streamed tools, output, files, usage, status, questions and polls
- [x] Native Codex app-server and DSH ACP approval transports
- [x] OpenClaw turn-scope approval and native exec requests through ACP
- [x] Detached conversation workers and recovery after HTTP-service restart
- [x] Pending approval recovery without resubmitting the original prompt
- [x] Real PTY, interactive input, resize, control keys and browser reconnect
- [x] Explicit approval before starting an interactive shell
- [x] Multiple SSH hosts, host metrics and selected service states
- [x] Read-only server files, agent file editing with version history
- [x] Read-only GitHub and Gmail connections
- [x] Private installation state excluded from source and npm payload
- [x] Installation and upgrade instructions include runtime requirements

## Further work

- [ ] CI workflow for the complete test and release checks
- [ ] Explicit recovery workflow after whole-machine reboot beyond continuing a saved runtime session
- [ ] Per-tool approvals for every OpenClaw gateway integration (current broader scope is explicit)
- [ ] Remote agent discovery and remote filesystem browser
- [ ] Host map view
- [ ] Screenshots in the README
- [ ] Declarative automations and reports

The 0.3.0 release remains under active development. Passing synthetic runtime tests
is not a guarantee that every installed third-party runtime version supports the same protocol.
