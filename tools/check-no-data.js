// Safety check: fails the build if customer data or secrets are in the repo.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const bad = [];
const skip = new Set(['node_modules', '.git', 'dist', 'data-private']);   // data-private is git-ignored and never uploaded
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    if (skip.has(f)) continue;
    const p = path.join(d, f), st = fs.statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    const rel = path.relative(root, p);
    if (/OrderHistory|old-store|new-store/i.test(f) && /\.json$/i.test(f)) bad.push(rel + '  (data file)');
    if (/\.(xlsx|csv|pem|pfx|key)$/i.test(f)) bad.push(rel + '  (data or secret file type)');
    if (st.size > 2 * 1024 * 1024 && !/\.(png|ico)$/i.test(f)) bad.push(rel + '  (unexpectedly large file)');
    if (/\.(js|json|html|bat|ps1|txt|md|yml)$/i.test(f) && st.size < 2 * 1024 * 1024) {
      const t = fs.readFileSync(p, 'utf8');
      if (/shp(at|ca|pa)_[0-9a-f]{20,}/i.test(t)) bad.push(rel + '  (looks like a Shopify access token)');
      if (/gh[pousr]_[A-Za-z0-9]{30,}/.test(t)) bad.push(rel + '  (looks like a GitHub token)');
    }
  }
}
walk(root);
if (bad.length) { console.error('STOP - private files found:\n' + bad.join('\n')); process.exit(1); }
console.log('check-no-data: OK (no customer data or tokens found)');
