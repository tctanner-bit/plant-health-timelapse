#!/usr/bin/env node
// Warehouse provisioning for a plug-and-play camera.
//
//   node scripts/provision-camera.mjs --serial 1234ABCD [--interval 300] [--dry-run]
//
// Creates an unclaimed camera (no org, no room) and prints:
//   - the sticker: claim code + serial, for the customer
//   - the settings to enter on the camera: FTPS server, login, schedule
//
// The FTP password is the camera's ingest token. Only its SHA-256 is stored,
// so this printout is the one chance to put it on the camera — configure the
// camera before closing the terminal. Lost it? Revoke and provision again.
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (never a customer machine).

import { createHash, randomInt } from "node:crypto";

const GATEWAY_HOST = process.env.GATEWAY_HOST ?? "phc-ftp.fly.dev";
const GATEWAY_PORT = process.env.GATEWAY_PORT ?? "21";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const serial = arg("serial")?.trim().toUpperCase();
const intervalSec = Number(arg("interval") ?? 300);

if (!serial || !/^[A-Z0-9-]{4,40}$/.test(serial)) {
  console.error("Usage: node scripts/provision-camera.mjs --serial <camera serial> [--interval 300] [--dry-run]");
  process.exit(1);
}
if (!Number.isInteger(intervalSec) || intervalSec < 60 || intervalSec > 86400) {
  console.error("--interval must be 60–86400 seconds");
  process.exit(1);
}

// Alphanumeric only: camera FTP password fields are picky about symbols.
// 27 base62 characters ≈ 160 bits; "phc_" + 27 = 31 characters total.
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const token = "phc_" + Array.from({ length: 27 }, () => BASE62[randomInt(62)]).join("");

// Crockford base32 (no I, L, O, U). Must match normalizeClaimCode() in
// lib/server/cameras.ts, which hashes "claim:" + the 8 bare characters.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const code = Array.from({ length: 8 }, () => CROCKFORD[randomInt(32)]).join("");
const printedCode = `${code.slice(0, 4)}-${code.slice(4)}`;

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const ftpUsername = `cam-${serial.toLowerCase()}`.slice(0, 31);

const row = {
  org_id: null,
  room_id: null,
  name: "Growlink camera",
  serial,
  ftp_username: ftpUsername,
  interval_sec: intervalSec,
  ingest_token_hash: sha256(token),
  token_hint: token.slice(-4),
  claim_code_hash: sha256("claim:" + code),
};

if (!dryRun) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or use --dry-run).");
    process.exit(1);
  }
  const res = await fetch(`${url}/rest/v1/cameras`, {
    method: "POST",
    headers: {
      apikey: key,
      // Legacy service_role keys are JWTs and go in Authorization too; new
      // sb_secret_ keys must only be sent as apikey.
      ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Could not register camera (HTTP ${res.status}): ${text}`);
    if (/serial/.test(text)) console.error("A camera with this serial is already provisioned.");
    process.exit(1);
  }
}

const minutes = intervalSec / 60;
console.log(`
${dryRun ? "DRY RUN — nothing was saved.\n" : ""}
STICKER (for the customer)
  Growlink camera · Serial ${serial}
  Setup code: ${printedCode}
  Plug into PoE, then add it in Plant Health AI with this code.

CAMERA SETTINGS (Reolink web UI → Settings)
  Network → Advanced → FTP
    Server address ....... ${GATEWAY_HOST}
    Port ................. ${GATEWAY_PORT}
    Username ............. ${ftpUsername}
    Password ............. ${token}
    Transport ............ FTPS (explicit TLS) — required
    Remote directory ..... /  (leave default; ignored)
    Upload ............... Pictures only, no video
    Interval / schedule .. every ${minutes} minute${minutes === 1 ? "" : "s"}, all day
    Picture resolution ... 1920×1080 (substream is too small, 4K is 13 GB/mo)
  System → Date & Time → NTP: on
  System → User → admin: unique password (record in the warehouse vault)
  Network: DHCP (default)

Then press "Test" on the FTP page. The gateway accepts the test file and the
camera shows as unclaimed-but-online until the customer enters the code.
`);
