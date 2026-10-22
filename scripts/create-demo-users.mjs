#!/usr/bin/env node
/**
 * CampusCare: create the 10 fictional demo logins in Supabase Auth.
 *
 * Runs ONLY on your own computer with Node.js 18+ (no packages needed).
 * It uses Supabase's Auth Admin API, which needs your project's SECRET key
 * (service_role / sb_secret_...). That key is read from an environment
 * variable that exists only in your current terminal window. It is never
 * written to a file, printed, or sent anywhere except your own Supabase project.
 *
 * Required environment variables:
 *   SUPABASE_URL          https://<your-project-ref>.supabase.co
 *   SUPABASE_SECRET_KEY   the service_role / secret key (Project Settings -> API Keys)
 *   DEMO_PASSWORD         the password to give every demo login (8+ characters)
 *
 * Usage:
 *   node scripts/create-demo-users.mjs --dry-run   (only lists what it would do)
 *   node scripts/create-demo-users.mjs             (creates missing logins)
 *
 * Safe to run more than once: logins that already exist are left untouched.
 */

if (typeof window !== "undefined") {
  throw new Error("This script must never run in a browser.");
}

const DEMO_USERS = [
  ["ananya.kulkarni@campuscare.demo", "Ananya Kulkarni"],
  ["rohan.deshpande@campuscare.demo", "Rohan Deshpande"],
  ["meera.joshi@campuscare.demo", "Prof. Meera Joshi"],
  ["sunita.patil@campuscare.demo", "Sunita Patil"],
  ["ramesh.jadhav@campuscare.demo", "Ramesh Jadhav"],
  ["anil.more@campuscare.demo", "Anil More"],
  ["suresh.pawar@campuscare.demo", "Suresh Pawar"],
  ["kiran.gaikwad@campuscare.demo", "Kiran Gaikwad"],
  ["lata.bhosale@campuscare.demo", "Lata Bhosale"],
  ["vikas.shinde@campuscare.demo", "Vikas Shinde"],
];

const dryRun = process.argv.includes("--dry-run");
const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const key = (process.env.SUPABASE_SECRET_KEY || "").trim();
const password = process.env.DEMO_PASSWORD || "";

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

// ---- check the settings before touching anything ----
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  fail("SUPABASE_URL is missing or not in the form https://<project-ref>.supabase.co");
}
if (!key) fail("SUPABASE_SECRET_KEY is not set in this terminal window.");
if (key.startsWith("sb_publishable_")) {
  fail("That is the publishable (public) key. This script needs the SECRET key.");
}
if (key.startsWith("eyJ")) {
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    if (payload.role !== "service_role") fail(`That key has role "${payload.role}". This script needs the service_role / secret key.`);
  } catch {
    fail("SUPABASE_SECRET_KEY does not look like a valid key.");
  }
} else if (!key.startsWith("sb_secret_")) {
  fail("SUPABASE_SECRET_KEY does not look like a Supabase secret key.");
}
if (!dryRun && password.length < 8) fail("DEMO_PASSWORD must be set and at least 8 characters long.");

const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function call(method, path, body) {
  const res = await fetch(`${url}/auth/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, data };
}

async function existingEmails() {
  const found = new Map();
  for (let page = 1; page <= 20; page++) {
    const { status, data } = await call("GET", `/admin/users?page=${page}&per_page=200`);
    if (status === 401 || status === 403) fail(`Supabase refused the key (HTTP ${status}). Check that it is this project's secret / service_role key.`);
    if (status !== 200) fail(`Could not list users (HTTP ${status}): ${data?.msg || data?.message || "unknown error"}`);
    const users = data?.users || [];
    for (const u of users) if (u.email) found.set(u.email.toLowerCase(), u);
    if (users.length < 200) break;
  }
  return found;
}

const existing = await existingEmails();
console.log(`\nProject: ${url}`);
console.log(dryRun ? "Mode: DRY RUN (nothing will be created)\n" : "Mode: create missing demo logins\n");

let created = 0, skipped = 0, failed = 0;
for (const [email, fullName] of DEMO_USERS) {
  const already = existing.get(email);
  if (already) {
    skipped++;
    const confirmed = already.email_confirmed_at ? "confirmed" : "NOT confirmed (confirm it in the dashboard)";
    console.log(`  • ${email}: already exists, left unchanged (${confirmed})`);
    continue;
  }
  if (dryRun) {
    console.log(`  + ${email}: would be created`);
    continue;
  }
  const { status, data } = await call("POST", "/admin/users", {
    email,
    password,
    email_confirm: true, // auto-confirm: no email is sent
    user_metadata: { full_name: fullName },
  });
  if (status === 200 || status === 201) {
    created++;
    console.log(`  ✓ ${email}: created and confirmed`);
  } else if (status === 422 && /exist|registered/i.test(JSON.stringify(data))) {
    skipped++;
    console.log(`  • ${email}: already exists, left unchanged`);
  } else {
    failed++;
    console.log(`  ✗ ${email}: failed (HTTP ${status}) ${data?.msg || data?.message || data?.error_description || ""}`);
  }
}

console.log(`\nDone. Created: ${created}, already existed: ${skipped}, failed: ${failed}.`);
if (failed) process.exit(1);
console.log("Next: run seed.sql in the Supabase SQL Editor (see SETUP.md).\n");
