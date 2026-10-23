# Install and upgrade

SpectraHub runs on your own Linux server. You need Node.js 20+, npm, Python 3
(the POSIX PTY bridge), and an OpenSSH client for remote hosts. Install those with
your distribution's package manager before continuing. Remote monitoring requires
Python 3 on each SSH host too.

```bash
npm install -g github:spectrahqteam/spectrahub
spectrahub init
spectrahub service install
spectrahub doctor
```

The terminal renderer is installed with npm and served locally. No CDN or browser
connection to a third party is required. Agent runtimes are optional and installed
separately; SpectraHub discovers them without copying your configuration.

`init` creates `~/.spectrahub` and prints a one-time login link. Open that link to
sign in. It expires after 15 minutes. The service listens on `127.0.0.1:8787`.
Set `SPECTRAHUB_HOME` or use `--dir PATH` to select another installation directory.

## HTTPS

Use your reverse proxy to terminate HTTPS:

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 3600s;
    proxy_buffering off;
}
```

Configure the server name and TLS certificate for your own domain. This is an SSE
application; no WebSocket proxy is needed. Do not expose the local HTTP port directly.

```bash
spectrahub login           # a new one-time link for another device
spectrahub token --rotate  # revoke the previous owner token
spectrahub status
```

## Interactive terminal and SSH hosts

Open **Terminal**, choose a host and request a terminal. The shell starts only after
you approve its scope. That approval covers commands entered in that shell until
it closes, under the selected operating-system account. It is not a separate approval
for each keystroke or command. The read-only command list remains available separately.

PTY sessions support interactive programs, resizing, control keys and reconnecting
the browser. Use **End shell** to close one. Inactive terminals expire after 30 minutes
by default (`terminal.idleTimeoutMs` in config, bounded to 1 minute–24 hours).
Terminal shells close when the HTTP server stops; conversation workers are separate.

Open **Servers** to add an SSH hostname or an existing SSH config alias. An empty port
uses the SSH configuration. Authentication uses existing keys or the SSH agent; the UI
does not accept private keys or passwords. Verify each host's fingerprint and establish
its `known_hosts` entry using your normal SSH workflow first. Unknown or changed host
keys are refused. SSH runs with `BatchMode=yes` and `StrictHostKeyChecking=yes`.

Optional service names on each host show their `systemctl is-active` status. The app
does not install software or modify services as part of monitoring.

## Conversation recovery

Each runtime turn runs in a separate worker. Its private journal stores events and
approval requests. Restarting the HTTP service reattaches to the same worker and
replays only events not yet saved in the conversation. It never resends the original
prompt automatically. You can answer a pending approval after reconnecting.

The generated systemd unit uses `KillMode=process` so restarting the HTTP service
does not kill conversation workers. Workers have an eight-hour deadline and a bounded
event journal. Stopping the service alone does not cancel those workers; stop active
turns in the app first when you intend to stop all agent activity.

A machine reboot or a killed worker interrupts the turn. The app reports that state
and retains the runtime session reference. Send a further message to continue; actions
already performed are never automatically repeated.

## Upgrade

Back up your installation directory and finish active work before replacing runtime
adapter code. Then reinstall the product and regenerate the service definition:

```bash
npm install -g github:spectrahqteam/spectrahub
spectrahub service install
systemctl --user restart spectrahub
spectrahub doctor
```

For a system service, use `spectrahub service install --system` with the appropriate
administrative privileges and `systemctl restart spectrahub`. A custom service must
adopt `KillMode=process` to support worker recovery. Existing JSON sessions are read
without a destructive migration; pre-worker turns cannot be recovered retroactively.

## Private data and backups

Everything specific to your installation belongs in `~/.spectrahub`, not the source:

```text
config.json        settings
token              owner token, mode 0600
hosts.json         SSH host definitions, mode 0600
data/sessions/     conversations and attachments
data/runs/         private worker journals and pending control messages
data/projects.json conversation groups
backups/           previous versions of edited agent files
```

Connected credentials are kept in private files in that directory. Provider keys
passed to a worker travel over a pipe, not its saved launch specification. Treat
conversation journals and attachments as private data and include them in backups.

The Git repository contains product code, synthetic tests and public documentation.
The npm payload is an explicit allowlist. Run `npm run check:release` before publishing;
it checks the source list, credential signatures and actual `npm pack` contents.

## Uninstall

Stop active agent turns and terminal sessions in the app first.

```bash
spectrahub service uninstall
npm uninstall -g spectrahub
```

Your installation directory is preserved. Remove it separately only if you intend
to delete your settings, credentials, conversations and backups.
