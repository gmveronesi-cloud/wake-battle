// Test UI passo 3.2: Numeri in ordine (beta + sfida vera + risposta rifiutata).
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

const attr = (page, sel, a) => page.getAttribute(sel, a);
async function tap(page, sel, from, to) {
  for (let n = from; n <= to; n++) await page.click(`${sel} .num-cell[data-n="${n}"]`);
}

(async () => {
  const browser = await start();
  const { A, B } = await setupCouple();
  T.fakeNow = '2026-09-20 10:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');

  // ===== 1. Beta =====
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: Numeri in ordine giocabile', await visible(page, 'button[data-code="numeri"]'));
  await page.click('button[data-code="numeri"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  const intro = await txt(page, '#b-game');
  check('beta: spiegazione 1-25 e nessuna penalità', intro.includes('da 1 a 25') && intro.includes('nessuna penalità'), intro);
  check('beta: griglia coperta prima di Inizia', (await page.locator('#b-game .num-cell').count()) === 0);
  await shot(page, '30_num_beta_intro');
  await page.click('#b-game .game-start');
  await page.waitForSelector('#b-game[data-phase="gioca"] .num-cell');
  const P = log.filter((x) => x.fn === 'beta_start').pop().r.parametri;
  const shown = await page.$$eval('#b-game .num-cell', (cs) => cs.map((c) => Number(c.textContent)));
  check('beta: 25 caselle nell\'ordine del server', JSON.stringify(shown) === JSON.stringify(P.disposizione), shown);
  const box = await page.locator('#b-game .num-grid').boundingBox();
  const cell = await page.locator('#b-game .num-cell').first().boundingBox();
  check('beta: griglia 5 colonne, caselle quadrate ≥ 50 px', cell.width >= 50 && Math.abs(cell.width - cell.height) < 2 && box.width >= cell.width * 5, [box, cell]);
  check('beta: Prossimo: 1', (await txt(page, '#b-game .game-note')) === 'Prossimo: 1');
  await tap(page, '#b-game', 1, 3);
  check('beta: dopo 3 tocchi Prossimo: 4', (await txt(page, '#b-game .game-note')) === 'Prossimo: 4' && (await attr(page, '#b-game', 'data-prossimo')) === '4');
  check('beta: 3 caselle spente', (await page.locator('#b-game .num-cell.preso').count()) === 3);
  await page.click('#b-game .num-cell[data-n="10"]');
  check('beta: errore lampeggia rosso', (await page.locator('#b-game .num-cell[data-n="10"].wrong').count()) === 1);
  check('beta: errore non fa ripartire', (await attr(page, '#b-game', 'data-prossimo')) === '4' && (await page.locator('#b-game .num-cell.preso').count()) === 3);
  await shot(page, '31_num_beta_errore');
  await page.waitForTimeout(450);
  check('beta: lampeggio finito dopo 0,3 s', (await page.locator('#b-game .num-cell.wrong').count()) === 0);
  await page.click('#b-game .num-cell[data-n="2"]', { force: true });
  check('beta: casella già fatta non conta', (await attr(page, '#b-game', 'data-prossimo')) === '4' && (await attr(page, '#b-game', 'data-errori')) === '1');
  await tap(page, '#b-game', 4, 20);
  await shot(page, '32_num_beta_quasi');
  await tap(page, '#b-game', 21, 25);
  await page.waitForSelector('#b-result:not([hidden])');
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  const expTaps = [...Array(25)].map((_, i) => P.disposizione.indexOf(i + 1));
  check('beta: risposta = posizioni di 1..25', JSON.stringify(bc.body.p_answer.tocchi) === JSON.stringify(expTaps), bc.body.p_answer);
  check('beta: errori 1 nella risposta', bc.body.p_answer.errori === 1);
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  check('beta: mostra errori: 1', (await txt(page, '#b-result-sub')).includes('errori: 1'), await txt(page, '#b-result-sub'));
  await shot(page, '33_num_beta_fatto');

  // ===== 2. Sfida vera =====
  await db.query("update public.challenge_types set enabled = (code = 'numeri'), game_live = (code = 'numeri')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  T.fakeNow = '2026-09-21 07:00:20+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('lun: challenge Numeri in ordine', (await txt(page, '#o-ch-name')) === 'Numeri in ordine');
  check('lun: niente Fatto', !(await visible(page, '#b-done')));
  check('lun: griglia coperta', (await page.locator('#o-game .num-cell').count()) === 0);
  await shot(page, '34_num_oggi_intro');
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="gioca"]');
  await tap(page, '#o-game', 1, 7);
  await shot(page, '35_num_oggi_gioca');
  await tabTo(page, 'sfida'); await tabTo(page, 'oggi');
  check('lun: cambio scheda non ricomincia', (await attr(page, '#o-game', 'data-prossimo')) === '8' && (await page.locator('#o-game .num-cell.preso').count()) === 7);
  await tap(page, '#o-game', 8, 25);
  await page.waitForSelector('#o-result:not([hidden])');
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok', cg.r.ok === true && cg.body.p_answer.tocchi.length === 25, cg.r);
  check('lun: Fatto in 0:20.0 (tempo dalla sveglia)', (await txt(page, '#o-result-main')) === 'Fatto in 0:20.0', await txt(page, '#o-result-main'));
  await shot(page, '36_num_oggi_fatto');

  // ===== 3. Risposta rifiutata -> stessa griglia da 1 =====
  T.fakeNow = '2026-09-22 07:01:00+02';
  await reload(page);
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="gioca"]');
  const orig = (await db.query("select params from public.couple_days where day = '2026-09-22'")).rows[0].params;
  const bad = JSON.parse(JSON.stringify(orig));
  const i1 = bad.disposizione.indexOf(1), i2 = bad.disposizione.indexOf(2);
  bad.disposizione[i1] = 2; bad.disposizione[i2] = 1;
  await db.query("update public.couple_days set params = $1 where day = '2026-09-22'", [JSON.stringify(bad)]);
  await tap(page, '#o-game', 1, 25);
  await page.waitForTimeout(700);
  check('mar: messaggio rifiutata', (await txt(page, '#msg')).includes('non accettata'), await txt(page, '#msg'));
  check('mar: si riparte da 1, nessuna casella spenta', (await attr(page, '#o-game', 'data-prossimo')) === '1' &&
    (await page.locator('#o-game .num-cell.preso').count()) === 0 && (await page.locator('#o-game .num-cell').count()) === 25);
  await db.query("update public.couple_days set params = $1 where day = '2026-09-22'", [JSON.stringify(orig)]);
  await tap(page, '#o-game', 1, 25);
  await page.waitForSelector('#o-result:not([hidden])');
  check('mar: poi registrato, Fatto in 1:00.0', (await txt(page, '#o-result-main')) === 'Fatto in 1:00.0', await txt(page, '#o-result-main'));

  check('nessun errore in console', errors.length === 0, errors);
  await finish(browser, 'UI passo 3.2');
})().catch(async (e) => { console.error(e); process.exit(2); });
