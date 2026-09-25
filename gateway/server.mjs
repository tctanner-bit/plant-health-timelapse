// FTPS front door for plug-and-play cameras.
//
// Reolink cameras can upload a snapshot to an FTP server on a timer, with no
// software on site. This gateway is that FTP server. It is a protocol
// translator and holds no secrets of its own:
//
//   camera ──FTPS (user: anything, pass: phc_<token>)──▶ gateway
//          ──HTTPS POST, Authorization: Bearer phc_<token>──▶ ingest-frame
//
// The camera's FTP password *is* its ingest token. Logging in is checked by
// asking ingest-frame (JSON heartbeat); each uploaded file is forwarded as
// one frame. Revoking a camera in the app therefore locks it out of FTP too.
// Directories, listings and renames are no-ops that succeed, so the camera's
// FTP client never trips over a filesystem that doesn't exist.

import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import path from "node:path";

const require = createRequire(import.meta.url);
const { FtpSrv, FileSystem } = require("ftp-srv");

const env = (k, d) => process.env[k] ?? d;
const INGEST_URL = env("INGEST_URL", "https://uqbfrvtiwxukqpaxczmq.supabase.co/functions/v1/ingest-frame");
const FTP_PORT = Number(env("FTP_PORT", "21"));
const PASV_URL = env("PASV_URL", "127.0.0.1"); // public IP/host cameras connect back to
const PASV_MIN = Number(env("PASV_MIN", "30000"));
const PASV_MAX = Number(env("PASV_MAX", "30009"));
const REQUIRE_TLS = env("REQUIRE_TLS", "true") !== "false";
const TLS_KEY = env("TLS_KEY_FILE", "/data/tls/key.pem");
const TLS_CERT = env("TLS_CERT_FILE", "/data/tls/cert.pem");

const MAX_BYTES = 10 * 1024 * 1024;
const LOGIN_CACHE_MS = 10 * 60 * 1000;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_LIMIT = 20;

const hint = (token) => "…" + token.slice(-4);
const hashOf = (s) => createHash("sha256").update(s).digest("hex");

function log(event, fields = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));
}

// ---------------------------------------------------------------- ingest calls

async function ingest(token, body, contentType) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Cameras log in for every upload; don't hit ingest-frame for each login.
const validLogins = new Map(); // sha256(token) → expiry

async function checkToken(token) {
  const h = hashOf(token);
  if ((validLogins.get(h) ?? 0) > Date.now()) return true;
  const { status } = await ingest(token, "{}", "application/json");
  if (status === 200) {
    validLogins.set(h, Date.now() + LOGIN_CACHE_MS);
    return true;
  }
  if (status === 401) return false;
  throw new Error(`ingest unavailable (HTTP ${status})`);
}

// Slow down anyone guessing passwords from one address.
const failures = new Map(); // ip → [timestamps]

function tooManyFailures(ip) {
  const recent = (failures.get(ip) ?? []).filter((t) => Date.now() - t < FAIL_WINDOW_MS);
  failures.set(ip, recent);
  return recent.length >= FAIL_LIMIT;
}
const noteFailure = (ip) => failures.set(ip, [...(failures.get(ip) ?? []), Date.now()]);

// ------------------------------------------------------------------ filesystem

const dirStat = (name) => ({
  name,
  isDirectory: () => true,
  size: 0,
  mtime: new Date(),
  mode: 0o755,
  uid: 0,
  gid: 0,
});

/** A write-only, stateless filesystem: every stored file becomes one frame. */
class IngestFileSystem extends FileSystem {
  constructor(connection, token, ip) {
    super(connection, { root: "/", cwd: "/" });
    this.token = token;
    this.ip = ip;
    this.cwdPath = "/";
  }

  currentDirectory() {
    return this.cwdPath;
  }

  resolve(p = ".") {
    return path.posix.resolve(this.cwdPath, p);
  }

  // Anything without an extension looks like a directory, so "does the upload
  // folder exist?" checks pass; files never exist, so nothing gets skipped.
  get(fileName) {
    const p = this.resolve(fileName);
    if (path.posix.extname(p)) {
      const err = new Error("No such file");
      err.code = "ENOENT";
      throw err;
    }
    return dirStat(path.posix.basename(p) || "/");
  }

  list() {
    return [];
  }

  chdir(p = ".") {
    this.cwdPath = this.resolve(p);
    return this.cwdPath;
  }

  mkdir(p) {
    return this.resolve(p);
  }

  delete() {}
  rename() {}
  chmod() {}

  read() {
    const err = new Error("Uploads only");
    err.code = "EACCES";
    throw err;
  }

  getUniqueName() {
    return randomUUID() + ".jpg";
  }

  write(fileName) {
    const { token, ip } = this;
    const chunks = [];
    let size = 0;

    // Forward in final(): 'finish' — and therefore the camera's 226 reply —
    // only happens once ingest-frame has accepted the frame. A failure turns
    // into an FTP error the camera can retry on its next cycle.
    const stream = new Writable({
      write(chunk, _enc, cb) {
        size += chunk.length;
        if (size > MAX_BYTES) return cb(new Error("File too large"));
        chunks.push(chunk);
        cb();
      },
      final(cb) {
        const body = Buffer.concat(chunks);
        ingest(token, body, "image/jpeg")
          .then(({ status, data }) => {
            if (status === 200) {
              log("frame", { cam: hint(token), ip, file: fileName, bytes: body.length, claimed: data.claimed, dup: data.duplicate });
              return cb();
            }
            if (status === 413 || status === 415) {
              // Not a JPEG (e.g. the camera was set to upload video). Accept and
              // drop, so it doesn't retry the same file forever.
              log("dropped", { cam: hint(token), ip, file: fileName, status });
              return cb();
            }
            if (status === 401) validLogins.delete(hashOf(token));
            log("ingest_error", { cam: hint(token), ip, status });
            cb(new Error(`Upload rejected (${status})`));
          })
          .catch((e) => {
            log("ingest_error", { cam: hint(token), ip, error: e.message });
            cb(new Error("Temporary failure, try again"));
          });
      },
    });
    return { stream, clientPath: this.resolve(fileName) };
  }
}

// ---------------------------------------------------------------------- server

function loadTls() {
  try {
    return { key: readFileSync(TLS_KEY), cert: readFileSync(TLS_CERT) };
  } catch {
    if (REQUIRE_TLS) {
      console.error(`TLS required but no key/cert at ${TLS_KEY} / ${TLS_CERT}`);
      process.exit(1);
    }
    return false;
  }
}

const server = new FtpSrv({
  url: `ftp://0.0.0.0:${FTP_PORT}`,
  pasv_url: PASV_URL,
  pasv_min: PASV_MIN,
  pasv_max: PASV_MAX,
  tls: loadTls(),
  anonymous: false,
  greeting: ["Growlink camera gateway"],
  // Nothing on this server is readable; refuse reads outright.
  blacklist: ["RETR", "SITE"],
  log: { trace() {}, debug() {}, info() {}, warn() {}, error() {}, child() { return this; } },
});

server.on("login", async ({ connection, password }, resolve, reject) => {
  const ip = connection.ip;
  try {
    if (tooManyFailures(ip)) return reject(new Error("Too many failed logins, try later"));
    // The password has already crossed the wire by now; refusing still keeps
    // a misconfigured camera from quietly running unencrypted.
    if (REQUIRE_TLS && !connection.secure) {
      log("login_plaintext_refused", { ip });
      return reject(new Error("Use explicit FTPS (AUTH TLS)"));
    }
    const token = String(password ?? "").trim();
    if (!token.startsWith("phc_") || !(await checkToken(token))) {
      noteFailure(ip);
      log("login_failed", { ip });
      return reject(new Error("Invalid credentials"));
    }
    log("login", { cam: hint(token), ip, tls: connection.secure });
    resolve({ fs: new IngestFileSystem(connection, token, ip) });
  } catch (e) {
    log("login_error", { ip, error: e.message });
    reject(new Error("Service temporarily unavailable"));
  }
});

server.on("client-error", ({ context, error }) => {
  log("client_error", { context, error: error?.message });
});

server.listen().then(() => {
  log("listening", { port: FTP_PORT, pasv: `${PASV_URL}:${PASV_MIN}-${PASV_MAX}`, requireTls: REQUIRE_TLS });
});

const shutdown = () => server.close().finally(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
