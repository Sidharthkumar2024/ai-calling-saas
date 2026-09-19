#!/usr/bin/env node

import process from "node:process";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const productionMode = process.argv[2] === "--production";
const databasePath =
  process.env.CALLVANI_SQLITE_PATH?.trim() ||
  (productionMode
    ? "/var/lib/callvani/runtime/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"
    : "");
const encryptionKey = process.env.VAANI_ENCRYPTION_KEY?.trim();
const host = productionMode
  ? "smtp.hostinger.com"
  : process.env.SMTP_HOST?.trim() || "";
const username = productionMode
  ? "noreply@callvani.com"
  : process.env.SMTP_USERNAME?.trim() || "";
const fromAddress = productionMode
  ? "noreply@callvani.com"
  : process.env.SMTP_FROM?.trim() || username;
const port = productionMode
  ? 465
  : Math.max(1, Number(process.env.SMTP_PORT) || 465);
const secure = productionMode || process.env.SMTP_SECURE !== "false";

if (
  !databasePath ||
  !encryptionKey ||
  encryptionKey.length < 32 ||
  !host ||
  !/^\S+@\S+\.\S+$/.test(username) ||
  !/^\S+@\S+\.\S+$/.test(fromAddress)
) {
  console.error(
    "Usage: set SMTP_HOST, SMTP_USERNAME, SMTP_FROM, SMTP_PORT, SMTP_SECURE, CALLVANI_SQLITE_PATH and VAANI_ENCRYPTION_KEY, or run with --production.",
  );
  process.exit(2);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    "Run this command in an interactive terminal so the mailbox password is never echoed or placed in shell history.",
  );
  process.exit(2);
}

async function hidden(prompt) {
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let value = "";
  try {
    for await (const chunk of process.stdin) {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          process.stdout.write("\n");
          return value;
        }
        if (character === "\u0003") throw new Error("Cancelled.");
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  return value;
}

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function encryptSecret(secret) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(encryptionKey),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

const password = (await hidden("Hostinger SMTP password (hidden): ")).trim();
if (password.length < 8 || password.length > 4000)
  throw new Error("The SMTP password length is invalid; nothing was saved.");

const database = new DatabaseSync(resolve(databasePath));
try {
  const encrypted = await encryptSecret(JSON.stringify({ password }));
  const config = JSON.stringify({
    host,
    port: String(port),
    secure: String(secure),
    username,
    fromAddress,
    fromName: "Call Vani",
  });
  database
    .prepare(
      `INSERT INTO platform_provider_secrets
      (provider, encrypted_secret, public_config_json, updated_by, updated_at)
      VALUES ('smtp', ?, ?, 'production_cli', CURRENT_TIMESTAMP)
      ON CONFLICT(provider) DO UPDATE SET
        encrypted_secret = excluded.encrypted_secret,
        public_config_json = excluded.public_config_json,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .run(encrypted, config);
  const stored = database
    .prepare(
      `SELECT provider,
      encrypted_secret LIKE 'v1.%' AS encrypted,
      json_extract(public_config_json, '$.host') AS host,
      json_extract(public_config_json, '$.username') AS username,
      updated_at FROM platform_provider_secrets WHERE provider = 'smtp'`,
    )
    .get();
  console.log(JSON.stringify(stored, null, 2));
} finally {
  database.close();
}
