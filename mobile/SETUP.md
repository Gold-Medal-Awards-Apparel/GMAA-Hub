# Gold Medal Hub — phone version (Worker) setup

Code-only. No secrets, no price lists. Rebuild with `node build.cjs` (makes dist/worker.js).
Tests: `node test/api_test.mjs` and `node test/ui_test.mjs` (need the D1 mock running).

Variables to set in Cloudflare (Workers > gmaa-hub-phone > Settings > Variables and Secrets):
- ACCESS_TEAM  your Zero Trust team name (the part before .cloudflareaccess.com)
- ACCESS_AUD   the Application Audience (AUD) tag of the Access application
- USERS        {"you@example.com":{"name":"Exact Staff Name"}}  (JSON; one entry per allowed email)
Binding: D1 database gmaa-hub as variable name DB.
The Worker refuses everything until all four are set, and refuses any request without a valid Access sign-in.
