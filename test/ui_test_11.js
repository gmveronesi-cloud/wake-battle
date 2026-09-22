// Test UI passo 3.5b: Riflessi "Babbo/Schiacciami" (beta + sfida vera + risposta rifiutata).
// Sostituisce la meccanica di ui_test_10.js (Riflessi v1, valido solo fino al file 10).
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

const attr = (page, sel, a) => page.getAttribute(sel, a);
const boxTexts = (page, sel) => page.$$eval(`${sel} .bb-box`, (els) => els.map((e) => e.textContent));

// aspetta la comparsa dei riquadri e tocca "SCHIACCIAMI!": n round di fila.
// I riquadri restano cliccabili anche da oscurati (data-ok resta sull'elemento),
// quindi non si aspetta la fase "mostra" (dura solo mostra_ms): basta l'elemento.
async function giusti(page, sel, n) {
  for (let i = 0; i < n; i++) {
    await page.waitForSelector(`${sel} .bb-box[data-ok="1"]`);
    await page.click(`${sel} .bb-box[data-ok="1"]`);
    if (i < n - 1) await page.waitForSelector(`${sel}[data-phase="aspetta"]`);
  }
}
// tocca "BABBO": si perde e si riparte dal round 1
async function sbaglia(page, sel) {
  await page.waitForSelector(`${sel} .bb-box[data-ok="0"]`);
  await page.click(`${sel} .bb-box[data-ok="0"]`);
}

(async () => {
  const browser = await start();
  const { A, B } = await setupCouple();
  T.fakeNow = '2026-09-20 10:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');

  // ===== 1. Beta =====
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: Riflessi giocabile', await visible(page, 'button[data-code="riflessi"]'));
  await page.click('button[data-code="riflessi"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  const intro = await txt(page, '#b-game');
  check('beta: spiegazione SCHIACCIAMI/BABBO + 5 round', intro.includes('SCHIACCIAMI') && intro.includes('BABBO') && intro.includes('5'), intro);
  check('beta: nessun riquadro prima di Inizia', (await page.locator('#b-game .bb-box').count()) === 0);
  await shot(page, '52_bab_beta_intro');
  await page.click('#b-game .game-start');
  check('beta: fase aspetta subito dopo Inizia', (await attr(page, '#b-game', 'data-phase')) === 'aspetta');

  // primo tentativo: sbaglia al round 1 (tocca "BABBO")
  await sbaglia(page, '#b-game');
  check('beta: errore rilevato', (await attr(page, '#b-game', 'data-phase')) === 'errore');
  await shot(page, '53_bab_beta_errore');
  await page.waitForTimeout(750);
  await page.waitForSelector('#b-game[data-phase="aspetta"]');
  check('beta: dopo errore si riparte dal round 1', (await attr(page, '#b-game', 'data-round')) === '1');

  // secondo tentativo: 5 round giusti di fila
  await page.waitForSelector('#b-game[data-phase="mostra"]');
  const texts = (await boxTexts(page, '#b-game')).slice().sort();
  check('beta: due riquadri BABBO / SCHIACCIAMI!', JSON.stringify(texts) === JSON.stringify(['BABBO', 'SCHIACCIAMI!']), texts);
  check('beta: Round 1 di 5', (await txt(page, '#b-game .game-note')) === 'Round 1 di 5');
  await shot(page, '54_bab_beta_mostra');
  await giusti(page, '#b-game', 5);
  await page.waitForSelector('#b-result:not([hidden])');
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  check('beta: risposta = tentativo 1 (2° tentativo), tentativi 2', JSON.stringify(bc.body.p_answer) === JSON.stringify({ tentativo: 1, tentativi: 2 }), bc.body.p_answer);
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  check('beta: mostra tentativi: 2', (await txt(page, '#b-result-sub')).includes('tentativi: 2'), await txt(page, '#b-result-sub'));
  await shot(page, '55_bab_beta_fatto');

  // ===== 2. Sfida vera =====
  await db.query("update public.challenge_types set enabled = (code = 'riflessi'), game_live = (code = 'riflessi')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  T.fakeNow = '2026-09-21 07:00:20+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('lun: challenge Riflessi', (await txt(page, '#o-ch-name')) === 'Riflessi');
  check('lun: niente Fatto', !(await visible(page, '#b-done')));
  check('lun: nessun riquadro prima di Inizia', (await page.locator('#o-game .bb-box').count()) === 0);
  await shot(page, '56_bab_oggi_intro');
  await page.click('#o-game .game-start');
  await giusti(page, '#o-game', 2);
  await shot(page, '57_bab_oggi_gioca');
  await tabTo(page, 'sfida'); await tabTo(page, 'oggi');
  check('lun: cambio scheda non ricomincia', (await attr(page, '#o-game', 'data-round')) === '3');
  await giusti(page, '#o-game', 3);
  await page.waitForSelector('#o-result:not([hidden])');
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok', cg.r.ok === true && cg.body.p_answer.tentativo === 0 && cg.body.p_answer.tentativi === 1, cg.r);
  check('lun: Fatto in 0:20.0 (tempo dalla sveglia)', (await txt(page, '#o-result-main')) === 'Fatto in 0:20.0', await txt(page, '#o-result-main'));
  await shot(page, '58_bab_oggi_fatto');

  // ===== 3. Risposta rifiutata -> nuovo tentativo (parametri ridotti lato server) =====
  T.fakeNow = '2026-09-22 07:01:00+02';
  await reload(page);
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="aspetta"]');
  const orig = (await db.query("select params from public.couple_days where day = '2026-09-22'")).rows[0].params;
  const bad = JSON.parse(JSON.stringify(orig));
  bad.sequenze = bad.sequenze.map((s) => s.slice(0, 4));   // troppo corte: 5 round non ci stanno più
  await db.query("update public.couple_days set params = $1 where day = '2026-09-22'", [JSON.stringify(bad)]);
  await giusti(page, '#o-game', 5);
  await page.waitForTimeout(700);
  check('mar: messaggio rifiutata', (await txt(page, '#msg')).includes('non accettata'), await txt(page, '#msg'));
  check('mar: nuovo tentativo dal round 1', (await attr(page, '#o-game', 'data-round')) === '1');
  await db.query("update public.couple_days set params = $1 where day = '2026-09-22'", [JSON.stringify(orig)]);
  await page.waitForSelector('#o-game[data-phase="aspetta"]');
  await giusti(page, '#o-game', 5);
  await page.waitForSelector('#o-result:not([hidden])');
  check('mar: poi registrato, Fatto in 1:00.0', (await txt(page, '#o-result-main')) === 'Fatto in 1:00.0', await txt(page, '#o-result-main'));

  check('nessun errore in console', errors.length === 0, errors);
  await finish(browser, 'UI passo 3.5b');
})().catch(async (e) => { console.error(e); process.exit(2); });
