# FTPS camera gateway

Reolink cameras upload a snapshot over FTPS on a timer. This service is the
FTP server they upload to. It forwards each file to the `ingest-frame` edge
function and keeps nothing.

- **Login:** the FTP password is the camera's `phc_…` ingest token. The
  username is ignored. The gateway validates the token against `ingest-frame`
  and caches valid tokens for 10 minutes.
- **Upload:** each stored file becomes one frame. The camera gets `226 OK`
  only after `ingest-frame` accepts it. A failure returns an FTP error, and
  the camera tries again on its next cycle.
- **Everything else:** directory commands succeed as no-ops, listings are
  empty, and downloads are refused.
- **Unclaimed cameras** can log in and upload. `ingest-frame` drops their
  frames but records that they're online.
- **Revoked cameras** can't upload, even with a cached login, and are
  refused at the next login.
- **Plain FTP is refused** (`REQUIRE_TLS=true`). Every failed login waits 2
  seconds before it's refused. Behind Fly's proxy, that delay is the only
  limit. On a VM with real client IPs, an IP with more than 20 failed logins
  in 10 minutes is also locked out until the window passes.

The gateway holds no Supabase keys. If it's compromised, the most an attacker
gets is the tokens of cameras that log in while they control it.

## Deploy (Fly.io)

Live as `phc-ftp` (dedicated IPv4 `137.66.12.41`, region `iad`). To
redeploy after changes:

```
cd gateway
fly deploy --ha=false --remote-only
```

First-time setup, for reference:

```
fly apps create phc-ftp
fly ips allocate-v4 -a phc-ftp
fly secrets set PASV_URL=<the IPv4> -a phc-ftp
fly deploy --ha=false --remote-only
```

Right after a deploy, Fly warns that nothing is listening on ports 30000–30009.
That's expected: passive ports open only for the length of an upload.

- **Dedicated IPv4 (about $2/month):** raw TCP services need one.
- **One machine:** a passive data connection has to reach the machine that
  holds the matching control connection.
- **Hostname:** cameras connect to `phc-ftp.fly.dev`. If you move to a custom
  domain, point it at the IPv4 and update `GATEWAY_HOST` in
  `scripts/provision-camera.mjs`.
- **Certificate:** optional. `fly secrets set TLS_KEY="$(cat key.pem)"
  TLS_CERT="$(cat cert.pem)"` installs a real one. Otherwise a self-signed
  certificate is generated at boot.

## Known caveat behind Fly's proxy

Confirmed in testing on 2026-09-25: every connection reaches the gateway
from Fly's proxy address (`172.16.x.x`), never the camera's real IP.

- **Passive uploads work.** `ftp-srv` requires the data connection to come
  from the same IP as the control connection. Both show the proxy address,
  so the check passes. It also can't tell clients apart, so it adds no
  protection here. The data channel is TLS either way.
- **Per-IP lockout is off behind the proxy.** It would lock out every
  camera at once. See the login delay above.
- **Logs show the proxy IP** rather than the site's IP.

If you need real client IPs (per-site lockout, per-site logs), run the same
Docker image on any VM with a public IP.

## Run locally

```
npm install
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 30 -subj "/CN=localhost"
FTP_PORT=2121 PASV_URL=127.0.0.1 TLS_KEY_FILE=key.pem TLS_CERT_FILE=cert.pem npm start
curl --ssl-reqd -k -T frame.jpg ftp://127.0.0.1:2121/frame.jpg -u cam:phc_<token>
```
