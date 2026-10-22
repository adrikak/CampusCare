# CampusCare: Supabase setup (about 30 minutes)

You need: `schema.sql` and `seed.sql` (the reviewed versions from 18 Oct, 23:00 or later), a browser, and a free Supabase account.

You do **not** need `fix_evidence_bucket.sql`. It was only for projects set up with the older `schema.sql`.

## Exact order

1. Create the project
2. Run `schema.sql`
3. Turn off public sign-ups
4. Create the 10 demo logins
5. Run `seed.sql`
6. Run the check query
7. (Optional) Look at the Security Advisor
8. Keep the Project URL and anon key for the app

---

## 1. Create the project (5 min)

1. Go to **supabase.com**, sign in (GitHub is easiest), and select **New project**.
2. Name: `campuscare`. Region: **South Asia (Mumbai)**.
3. Set a database password and save it somewhere safe.
4. Wait about 2 minutes until the project shows as ready.

## 2. Run `schema.sql` (2 min)

1. Left sidebar → **SQL Editor** → **New query**.
2. Open `schema.sql`, copy **everything**, paste it in, and select **Run**.
3. Expected result: "Success. No rows returned".

Run it **once only**. If you see `type "app_role" already exists`, it has already been run on this project. Nothing is broken; just don't run it again, and tell me.

If you see any other red error, copy the full text and send it to me. Don't edit the file.

## 3. Turn off public sign-ups (1 min)

**Authentication** → **Sign In / Providers** (the name varies slightly) → **Email** → turn **off** "Allow new users to sign up" → **Save**.

Now only the logins you create yourself (step 4) can sign in. You can still add users from the dashboard.

## 4. Create the 10 demo logins (5–10 min)

Choose **one** option.

### Option A: script on your laptop (needs Node.js 18+)

The script `scripts/create-demo-users.mjs` creates any missing demo logins, already confirmed. It skips logins that exist, so it's safe to run twice. The secret key lives only in your terminal window: it isn't saved in a file, printed, or committed.

In **PowerShell**, in the folder that contains `scripts`:

```powershell
$env:SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co"
$env:SUPABASE_SECRET_KEY = Read-Host "Paste the secret key, then press Enter"
$env:DEMO_PASSWORD = Read-Host "Choose a password for the demo logins"
node scripts/create-demo-users.mjs --dry-run
node scripts/create-demo-users.mjs
Remove-Item Env:SUPABASE_SECRET_KEY
```

- The secret key is in **Project Settings → API Keys**: the **secret** key (`sb_secret_…`), or the legacy **service_role** key. **Never** paste it into chat, a file you commit, or the web app.
- The dry run only lists what would be created. The second command creates them and ends with "Done. Created: 10 …".
- If it says the key was refused, you copied the publishable/anon key or a key from another project.
- Pasting with `Read-Host` keeps the key and the password out of PowerShell's command history. It shows on your own screen while you paste, so don't screen-share at that moment.
- Closing the PowerShell window also forgets the key.

### Option B: by hand in the dashboard

**Authentication** → **Users** → **Add user** → **Create new user**. For each email below: use the same password for all (choose your own; don't write it in this repository), tick **Auto Confirm User**, and select **Create user**.

| Email | Becomes (set by `seed.sql`) |
|---|---|
| ananya.kulkarni@campuscare.demo | Student |
| rohan.deshpande@campuscare.demo | Student |
| meera.joshi@campuscare.demo | Faculty (Prof. Meera Joshi) |
| sunita.patil@campuscare.demo | Administrator |
| ramesh.jadhav@campuscare.demo | Maintenance, Electrical |
| anil.more@campuscare.demo | Maintenance, Electrical |
| suresh.pawar@campuscare.demo | Maintenance, Plumbing |
| kiran.gaikwad@campuscare.demo | Maintenance, IT Support |
| lata.bhosale@campuscare.demo | Maintenance, Housekeeping |
| vikas.shinde@campuscare.demo | Maintenance, General Maintenance |

All names are fictional. The `.demo` addresses never receive email.

If you create the logins before step 2 by mistake, that's fine: `seed.sql` repairs it.

## 5. Run `seed.sql` (1 min)

SQL Editor → **New query** → paste all of `seed.sql` → **Run**.

Supabase will warn that the query has **destructive operations**. That's expected, and it's safe to confirm. The only `DELETE` removes the nine sample IDs CC-<year>-0101…0109, and only if they were reported by a demo login. The only `DROP` removes the script's own temporary helper. All data changes happen in one step, so if anything fails, nothing changes.

- If it says **"Create these logins first: …"**, the listed emails are missing or misspelled. Add or fix them in step 4, then run `seed.sql` again.
- **Re-run `seed.sql` the day before any demo or test session.** The two sample visits are booked for "tomorrow", and re-running refreshes all the sample dates. It only replaces the 9 sample complaints (…-0101 to …-0109). Anything created in the app is kept.

## 6. Check it worked (1 min)

New query:

```sql
select id, status, closed_as, priority, assignee_name,
       public.fmt_slot(visit_start, visit_end, visit_days) as visit
from complaints order by id;
```

Expected: 9 rows, CC-2026-0101 to CC-2026-0109:

| ID | Status | Assignee | Visit |
|---|---|---|---|
| 0101 | In Progress | Ramesh Jadhav | — |
| 0102 | Assigned | Suresh Pawar | tomorrow 10:00–11:00 |
| 0103 | Resolved | Vikas Shinde | — |
| 0104 | Closed (`fixed`) | Kiran Gaikwad | — |
| 0105 | Under Review | — | — |
| 0106 | Resolved | Ramesh Jadhav | — |
| 0107 | Assigned | Ramesh Jadhav | tomorrow 09:00–10:00 |
| 0108 | Submitted | — | — |
| 0109 | Closed (`not_actionable`) | — | — |

## 7. (Optional) Security Advisor (1 min)

Left sidebar → **Advisors** → **Security Advisor**. Send me a screenshot of anything listed under **Errors**. Warnings about features that need a paid plan (for example leaked-password protection) can be ignored for this project.

## 8. Keep two values for the app

**Project Settings** → **API** (or **Data API** / **API Keys**):

- **Project URL** (`https://xxxx.supabase.co`)
- **anon / publishable** key (`eyJ…` or `sb_publishable_…`)

These are meant to sit inside a web app, because the database rules protect the data.

**Never share the `service_role` / secret key**, not even with me. It bypasses every rule.

---

## Good to know

- **Deleting a demo login that has complaints will fail** with a database error. That's deliberate, so complaint history is never lost.
- **Roles can only be changed by SQL in this dashboard.** Nobody can make themselves an admin from the app.
- **What has been tested:** both files were tested on PostgreSQL 16 on my side, with stand-ins for Supabase's login and storage parts. That's 72 automated checks: who can see what, every lifecycle rule, booking clashes, file-path rules, and the sample data. Your Supabase project itself has **not** been tested yet; running these steps is that test.
