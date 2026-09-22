// Test UI passo 3.3: Colore della parola (beta + sfida vera + risposta rifiutata).
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

const NOMI = ['ROSSO', 'BLU', 'VERDE', 'GIALLO', 'VIOLA', 'ARANCIONE'];
const attr = (page, sel, a) => page.getAttribute(sel, a);
// tocca il colore giusto (inchiostro mostrato) per n turni
async function giusti(page, sel, n) {
  for (let i = 0; i < n; i++) {
    const c = await attr(page, `${sel} .cp-word`, 'data-inchiostro');
    await page.click(`${sel} .cp-key[data-c="${c}"]`);
  }
}
async function sbaglia(page, sel) {
  const c = Number(await attr(page, `${sel} .cp-word`, 'data-inchiostro'));
  const w = (c + 1) % 6;
  await page.click(`${sel} .cp-key[data-c="${w}"]`);
  return w;
}

(async () => {
  const browser = await start();
  const { A, B } = await setupCouple();
  T.fakeNow = '2026-09-20 10:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');

  // ===== 1. Beta =====
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: Colore della parola giocabile', await visible(page, 'button[data-code="colore_parola"]'));
  await page.click('button[data-code="colore_parola"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  const intro = await txt(page, '#b-game');
  check('beta: spiegazione inchiostro + errore', intro.includes('INCHIOSTRO') && intro.includes('turno 1'), intro);
  check('beta: parola coperta prima di Inizia', (await page.locator('#b-game .cp-word').count()) === 0);
  await shot(page, '37_col_beta_intro');
  await page.click('#b-game .game-start');
  await page.waitForSelector('#b-game[data-phase="gioca"] .cp-word');
  const P = log.filter((x) => x.fn === 'beta_start').pop().r.parametri;
  const S = P.sequenze;
  const w0 = S[0][0];
  check('beta: turno 1 = parola e inchiostro del server', (await txt(page, '#b-game .cp-word')) === NOMI[w0[0]] &&
    (await attr(page, '#b-game .cp-word', 'data-inchiostro')) === String(w0[1]) &&
    (await page.locator(`#b-game .cp-word.cp-ink${w0[1]}`).count()) === 1);
  const inkRgb = await page.$eval('#b-game .cp-word', (e) => getComputedStyle(e).color);
  const keyInk = await page.$eval(`#b-game .cp-key[data-c="${w0[0]}"]`, (e) => getComputedStyle(e).color);
  check('beta: parola colorata, pulsanti in nero', inkRgb !== 'rgb(0, 0, 0)' && keyInk === 'rgb(0, 0, 0)', [inkRgb, keyInk]);
  const keyOrd = (sel) => page.$$eval(`${sel} .cp-key`, (ks) => ks.map((k) => Number(k.dataset.c)));
  const keys = await page.$$eval('#b-game .cp-key', (ks) => ks.map((k) => k.textContent));
  check('beta: 6 pulsanti, tutti i colori una volta', JSON.stringify([...keys].sort()) === JSON.stringify([...NOMI].sort()), keys);
  // ordine dei pulsanti: cambia a ogni turno ed è uguale per chi ha gli stessi parametri
  const ordini = [await keyOrd('#b-game')];
  check('beta: ordine a schermo = data-ordine', ordini[0].join(',') === (await attr(page, '#b-game', 'data-ordine')));
  const k0 = await page.locator('#b-game .cp-key').nth(0).boundingBox();
  const k1 = await page.locator('#b-game .cp-key').nth(1).boundingBox();
  const k2 = await page.locator('#b-game .cp-key').nth(2).boundingBox();
  check('beta: pulsanti su 2 colonne, alti ≥ 50 px', Math.abs(k0.y - k1.y) < 2 && k2.y > k0.y && k0.height >= 50 && k0.x + k0.width <= k1.x, [k0, k1]);
  check('beta: Turno 1 di 10', (await txt(page, '#b-game .game-note')) === 'Turno 1 di 10');
  await shot(page, '38_col_beta_turno1');
  for (let i = 0; i < 4; i++) { await giusti(page, '#b-game', 1); ordini.push(await keyOrd('#b-game')); }
  check('beta: ordine pulsanti diverso a ogni turno', ordini.every((o, i) => i === 0 || o.join() !== ordini[i - 1].join()), ordini);
  check('beta: ordini non tutti uguali all\'ordine base', ordini.some((o) => o.join() !== '0,1,2,3,4,5'), ordini);
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto('http://localhost:8765/beta.html').catch(() => {});
  const ordiniB = await p2.evaluate((pp) => new Promise((res) => {
    const s = document.createElement('script'); s.src = '/games.js';
    s.onload = () => {
      const box = document.createElement('div'); document.body.appendChild(box);
      window.WBGames.mount('colore_parola', box, pp, { onDone() {} });
      box.querySelector('.game-start').click();
      const out = [];
      for (let t = 0; t < 5; t++) {
        out.push([...box.querySelectorAll('.cp-key')].map((k) => Number(k.dataset.c)));
        box.querySelector(`.cp-key[data-c="${box.querySelector('.cp-word').dataset.inchiostro}"]`).click();
      }
      res(out);
    };
    document.head.appendChild(s);
  }), P);
  await ctx2.close();
  check('beta: stessi parametri → stesso ordine (uguale per la coppia)', JSON.stringify(ordiniB) === JSON.stringify(ordini), [ordiniB, ordini]);
  check('beta: dopo 4 giusti turno 5', (await attr(page, '#b-game', 'data-turno')) === '5' &&
    (await page.locator('#b-game .cp-dots .cp-ok').count()) === 4 && (await txt(page, '#b-game .cp-word')) === NOMI[S[0][4][0]]);
  const wrongC = await sbaglia(page, '#b-game');
  check('beta: errore lampeggia rosso', (await page.locator(`#b-game .cp-key[data-c="${wrongC}"].cp-wrong`).count()) === 1 &&
    (await attr(page, '#b-game', 'data-phase')) === 'errore');
  check('beta: messaggio si riparte', (await txt(page, '#b-game .game-note')).includes('turno 1'));
  await shot(page, '39_col_beta_errore');
  await page.waitForTimeout(400);
  check('beta: lampeggio finito dopo 0,3 s', (await page.locator('#b-game .cp-wrong').count()) === 0);
  await page.waitForSelector('#b-game[data-phase="gioca"]');
  check('beta: ripartito dal turno 1 con parole nuove', (await attr(page, '#b-game', 'data-turno')) === '1' &&
    (await attr(page, '#b-game', 'data-tentativo')) === '2' && (await txt(page, '#b-game .cp-word')) === NOMI[S[1][0][0]] &&
    (await attr(page, '#b-game .cp-word', 'data-inchiostro')) === String(S[1][0][1]));
  check('beta: pallini azzerati', (await page.locator('#b-game .cp-dots .cp-ok').count()) === 0);
  await giusti(page, '#b-game', 9);
  await shot(page, '40_col_beta_turno10');
  await giusti(page, '#b-game', 1);
  await page.waitForSelector('#b-result:not([hidden])');
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  check('beta: risposta = tentativo 1, inchiostri, tentativi 2', JSON.stringify(bc.body.p_answer) ===
    JSON.stringify({ tentativo: 1, risposte: S[1].map((t) => t[1]), tentativi: 2 }), bc.body.p_answer);
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  check('beta: mostra tentativi: 2', (await txt(page, '#b-result-sub')).includes('tentativi: 2'), await txt(page, '#b-result-sub'));
  await shot(page, '41_col_beta_fatto');

  // ===== 2. Sfida vera =====
  await db.query("update public.challenge_types set enabled = (code = 'colore_parola'), game_live = (code = 'colore_parola')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  T.fakeNow = '2026-09-21 07:00:20+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('lun: challenge Colore della parola', (await txt(page, '#o-ch-name')) === 'Colore della parola');
  check('lun: niente Fatto', !(await visible(page, '#b-done')));
  check('lun: parola coperta', (await page.locator('#o-game .cp-word').count()) === 0);
  await shot(page, '42_col_oggi_intro');
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="gioca"]');
  await giusti(page, '#o-game', 6);
  await shot(page, '43_col_oggi_gioca');
  await tabTo(page, 'sfida'); await tabTo(page, 'oggi');
  check('lun: cambio scheda non ricomincia', (await attr(page, '#o-game', 'data-turno')) === '7' &&
    (await attr(page, '#o-game', 'data-tentativo')) === '1');
  await giusti(page, '#o-game', 4);
  await page.waitForSelector('#o-result:not([hidden])');
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok', cg.r.ok === true && cg.body.p_answer.tentativo === 0 && cg.body.p_answer.risposte.length === 10, cg.r);
  check('lun: Fatto in 0:20.0 (tempo dalla sveglia)', (await txt(page, '#o-result-main')) === 'Fatto in 0:20.0', await txt(page, '#o-result-main'));
  await shot(page, '44_col_oggi_fatto');

  // ===== 3. Risposta rifiutata -> nuovo tentativo con parole nuove =====
  T.fakeNow = '2026-09-22 07:01:00+02';
  await reload(page);
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="gioca"]');
  const orig = (await db.query("select params from public.couple_days where day = '2026-09-22'")).rows[0].params;
  const bad = JSON.parse(JSON.stringify(orig));
  bad.sequenze[0][9][1] = (bad.sequenze[0][9][1] + 1) % 6;
  await db.query("update public.couple_days set params = $1 where day = '2026-09-22'", [JSON.stringify(bad)]);
  await giusti(page, '#o-game', 10);
  await page.waitForTimeout(700);
  check('mar: messaggio rifiutata', (await txt(page, '#msg')).includes('non accettata'), await txt(page, '#msg'));
  check('mar: nuovo tentativo dal turno 1 con la sequenza 2', (await attr(page, '#o-game', 'data-turno')) === '1' &&
    (await attr(page, '#o-game', 'data-tentativo')) === '2' && (await txt(page, '#o-game .cp-word')) === NOMI[orig.sequenze[1][0][0]]);
  await db.query("update public.couple_days set params = $1 where day = '2026-09-22'", [JSON.stringify(orig)]);
  await giusti(page, '#o-game', 10);
  await page.waitForSelector('#o-result:not([hidden])');
  check('mar: poi registrato, Fatto in 1:00.0', (await txt(page, '#o-result-main')) === 'Fatto in 1:00.0', await txt(page, '#o-result-main'));

  check('nessun errore in console', errors.length === 0, errors);
  await finish(browser, 'UI passo 3.3');
})().catch(async (e) => { console.error(e); process.exit(2); });
