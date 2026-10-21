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

## Uninstall

```bash
spectrahub service uninstall
npm uninstall -g spectrahub
rm -rf ~/.spectrahub        # this deletes your data
```

## Where things live

```
~/.spectrahub/config.json   settings (port, host, owner)
~/.spectrahub/data/         state — this is what you back up
~/.spectrahub/logs/         logs
```

Set `SPECTRAHUB_HOME` to use a different directory.
