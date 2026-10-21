# Install

SpectraHub runs on your own VPS. One Node process, one config directory, no database server.

## Requirements

- Linux VPS (tested on Ubuntu 22.04+ and Debian 12+)
- Node.js 20 or newer (`node -v`)
- optional: nginx or Caddy in front for HTTPS

## Install

```bash
npm install -g github:spectrahqteam/spectrahub
spectrahub init
```

`init` creates `~/.spectrahub/` with `config.json`, `data/` and `logs/`. The server binds to
`127.0.0.1:8787` by default — it is not exposed to the internet until you put a proxy in front.

Try it:

```bash
spectrahub serve
curl -s localhost:8787/health
```

## Run as a service

```bash
spectrahub service install          # user unit (no root needed)
sudo spectrahub service install --system   # system-wide unit
```

Then:

```bash
spectrahub status
spectrahub doctor
```

`doctor` prints one line per check and fails loudly if something is off.

## Put it behind HTTPS

SpectraHub speaks plain HTTP on localhost. Termination is the job of a proxy you already trust.

nginx:

```nginx
server {
    listen 443 ssl;
    server_name hub.example.com;
    ssl_certificate     /etc/letsencrypt/live/hub.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hub.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Then issue a certificate with certbot or acme.sh, exactly as for any other site.

## Terminal

`spectrahub init` creates the owner token and prints a one-time login link. Open it once and the
browser is signed in — nothing to type:

```bash
spectrahub init --url https://hub.example.com   # --url makes the link point at your public address
spectrahub login            # print the login link again (for a new phone or laptop)
spectrahub token            # print the bare token; it lives in ~/.spectrahub/token (mode 600)
spectrahub token --rotate   # replace it; every device logs in again
```

The token travels in the link's `#fragment`, which browsers never send to the server, so it does
not end up in proxy logs; the page removes it from the address bar at once. Settings (the gear in
the terminal window) show the token of this device, copy a login link for another device, and
log out. Treat the link like a password. Without a token every terminal call answers 401, and
with no token file at all it answers 403.

The terminal is read-only for now: only an exact list of command lines runs (`help` shows it),
without a shell, with a 15 s limit and a capped output. There is no PTY, so the page says
"bez TTY" and interactive programs are not available. Output is streamed as server-sent events;
SpectraHub sends `X-Accel-Buffering: no`, so nginx passes it through without extra config.

## Uninstall

```bash
spectrahub service uninstall
npm uninstall -g spectrahub
rm -rf ~/.spectrahub        # this deletes your data
```

## Where things live

```
~/.spectrahub/config.json   settings (port, host, owner)
~/.spectrahub/token        owner token for the terminal (mode 600, never in config.json)
~/.spectrahub/data/         state — this is what you back up
~/.spectrahub/logs/         logs
```

Set `SPECTRAHUB_HOME` to use a different directory.
