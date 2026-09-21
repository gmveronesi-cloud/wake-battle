// Banco di prova UI comune: web app vera in Chromium (iPhone 13), chiamate Supabase
// inoltrate al Postgres locale (01 + 02 + 03) con orologio del server simulato.
const { chromium, devices } = require('playwright');
const { Client } = require('pg');
const http = require('http');
const fs = require('fs');
const path = require('path');

// file web: cartella web/ (vecchia struttura) oppure radice del repo GitHub
const WEB = fs.existsSync(path.join(__dirname, '..', 'web', 'index.html'))
  ? path.join(__dirname, '..', 'web') : path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const SUPA = 'https://rxxqdseojllcniowrzxm.supabase.co';

const T = { fakeNow: '2026-09-20 10:00:00+02', fails: 0, passes: 0 };
const check = (label, cond, extra) => {
  if (cond) T.passes++; else { T.fails++; console.log('FAIL', label, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// ---------- server statico ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(WEB, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

// ---------- database ----------
const db = new Client({ host: '/tmp', port: 5433, user: 'postgres', database: 'wb' });

let queue = Promise.resolve();
function asUser(uid, fn) {
  const run = queue.then(() => asUserNow(uid, fn));
  queue = run.catch(() => {});
  return run;
}
async function asUserNow(uid, fn) {
  await db.query('begin');
  try {
    await db.query("select set_config('wb.fake_now', $1, true), set_config('request.jwt.claim.sub', $2, true)", [T.fakeNow, uid]);
    await db.query('set local role authenticated');
    const r = await fn();
    await db.query('commit');
    return r;
  } catch (e) { await db.query('rollback'); throw e; }
}

const RPC_ARGS = {
  set_alarm: [['p_time', 'time'], ['p_days', 'int[]']],
  set_prize: [['p_text', 'text']],
  get_week: [['p_week_start', 'date']],
  join_couple: [['p_code', 'text']],
  complete_game: [['p_answer', 'jsonb']],
  beta_start: [['p_code', 'text']],
  beta_check: [['p_code', 'text'], ['p_params', 'jsonb'], ['p_answer', 'jsonb']],
};
async function rpc(uid, fn, body) {
  const defs = (RPC_ARGS[fn] || []).filter(([n]) => body && n in body);
  const sql = `select public.${fn}(${defs.map(([n, t], i) => `${n} => $${i + 1}::${t}`).join(', ')}) as r`;
  const vals = defs.map(([n, t]) => (t === 'jsonb' ? JSON.stringify(body[n]) : body[n]));
  return asUser(uid, async () => (await db.query(sql, vals)).rows[0].r);
}
const log = [];   // registro delle RPC chiamate dal browser

// ---------- finta sessione Supabase ----------
function b64u(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function session(uid, email) {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
  const at = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: uid, exp, role: 'authenticated', aud: 'authenticated', email }) + '.sig';
  return { access_token: at, refresh_token: 'r', token_type: 'bearer', expires_in: 3600 * 24 * 30, expires_at: exp,
    user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-09-20T00:00:00Z' } };
}

async function openApp(browser, uid, email) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], timezoneId: 'Europe/Rome', locale: 'it-IT' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  if (uid) await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, ['sb-rxxqdseojllcniowrzxm-auth-token', JSON.stringify(session(uid, email))]);
  await page.route(SUPA + '/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    try {
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const fn = url.pathname.split('/').pop();
        const body = req.postData() ? JSON.parse(req.postData()) : {};
        const r = await rpc(uid, fn, body);
        log.push({ fn, body, r });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
      }
      if (url.pathname === '/rest/v1/profiles' && req.method() === 'GET') {
        const id = (url.searchParams.get('id') || '').replace('eq.', '');
        const rows = await asUser(uid, async () => (await db.query('select display_name from public.profiles where id = $1', [id])).rows);
        const obj = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj ? (rows[0] || null) : rows) });
      }
      if (url.pathname === '/rest/v1/couple_members' && req.method() === 'GET') {
        const rows = await asUser(uid, async () => (await db.query('select user_id from public.couple_members')).rows);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
      }
      console.log('richiesta non gestita', req.method(), url.pathname);
      return route.fulfill({ status: 404, body: '{}' });
    } catch (e) {
      console.log('errore SQL', url.pathname, e.message);
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: e.message }) });
    }
  });
  return { ctx, page, errors };
}

const txt = (page, sel) => page.locator(sel).innerText();
const visible = (page, sel) => page.locator(sel).isVisible();
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); }
async function reload(page) { await page.reload(); await page.waitForSelector('#v-main:not([hidden])'); await page.waitForTimeout(400); }
async function tabTo(page, t) { await page.click(`.tab[data-tab="${t}"]`); await page.waitForTimeout(400); }

async function setupCouple() {
  const A = (await db.query("insert into auth.users (email) values ('gianmarco@x.it') returning id")).rows[0].id;
  const B = (await db.query("insert into auth.users (email) values ('giulia@x.it') returning id")).rows[0].id;
  await db.query("update public.profiles set display_name = 'Gianmarco' where id = $1", [A]);
  await db.query("update public.profiles set display_name = 'Giulia' where id = $1", [B]);
  const c = (await db.query('insert into public.couples (created_by) values ($1) returning id', [A])).rows[0].id;
  await db.query("insert into public.couple_members (couple_id, user_id, joined_at) values ($1, $2, '2026-09-20 09:00+02'), ($1, $3, '2026-09-20 09:00+02')", [c, A, B]);
  return { A, B, c };
}

async function start() {
  await db.connect();
  await new Promise((r) => server.listen(8765, r));
  return chromium.launch();
}
async function finish(browser, label) {
  await browser.close();
  server.close();
  await db.end();
  console.log(`\n${T.passes} controlli ${label} superati, ${T.fails} falliti`);
  process.exit(T.fails ? 1 : 0);
}

module.exports = { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish };
