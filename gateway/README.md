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
- **Plain FTP is refused** (`REQUIRE_TLS=true`). More than 20 failed logins
  from one IP within 10 minutes locks that IP out until the window passes.

The gateway holds no Supabase keys. If it's compromised, the most an attacker
gets is the tokens of cameras that log in while they control it.

## Deploy (Fly.io)

```
cd gateway
fly launch --no-deploy --copy-config --name phc-ftp
fly ips allocate-v4
fly secrets set PASV_URL=<the IPv4 from the previous step>
fly deploy
fly scale count 1
```

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

`ftp-srv` accepts a passive data connection only if it comes from the same IP
as the control connection. Behind Fly's TCP proxy, the gateway sees proxy
addresses rather than the camera's, so that check becomes a no-op, or it can
reject legitimate connections if the two connections arrive through different
proxy hosts. If uploads fail with "Remote addresses do not match", or you
want the check to actually protect uploads, run the same Docker image on any
VM with a public IP. The data channel is TLS either way.

## Run locally

```
npm install
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 30 -subj "/CN=localhost"
FTP_PORT=2121 PASV_URL=127.0.0.1 TLS_KEY_FILE=key.pem TLS_CERT_FILE=cert.pem npm start
curl --ssl-reqd -k -T frame.jpg ftp://127.0.0.1:2121/frame.jpg -u cam:phc_<token>
```
