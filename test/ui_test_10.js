// Test UI passo 3.5: Riflessi (beta + sfida vera + risposta rifiutata).
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

const attr = (page, sel, a) => page.getAttribute(sel, a);

// aspetta che il riquadro diventi verde e lo tocca: n volte di fila
async function giusti(page, sel, n) {
  for (let i = 0; i < n; i++) {
    await page.waitForSelector(`${sel}[data-phase="tocca"] .rf-box`);
    await page.click(`${sel} .rf-box`);
  }
}
// tocca il riquadro mentre è ancora rosso (anticipo): il turno si ripete
async function anticipo(page, sel) {
  await page.waitForSelector(`${sel}[data-phase="aspetta"] .rf-box`);
  await page.click(`${sel} .rf-box`);
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
  check('beta: spiegazione 5 volte + anticipo', intro.includes('5') && intro.includes('anticipo'), intro);
  check('beta: nessun riquadro prima di Inizia', (await page.locator('#b-game .rf-box').count()) === 0);
  await shot(page, '45_rif_beta_intro');
  await page.click('#b-game .game-start');
  await page.waitForSelector('#b-game[data-phase="aspetta"] .rf-box');
  check('beta: riquadro rosso "ASPETTA…"', (await txt(page, '#b-game .rf-box')) === 'ASPETTA…' &&
    (await page.locator('#b-game .rf-box.rf-rosso').count()) === 1);
  check('beta: Round 1 di 5', (await txt(page, '#b-game .game-note')) === 'Round 1 di 5');

  // anticipo: tocca subito, mentre è ancora rosso -> il turno 1 si ripete
  await anticipo(page, '#b-game');
  check('beta: anticipo rilevato', (await attr(page, '#b-game', 'data-phase')) === 'errore');
  await shot(page, '46_rif_beta_errore');
  await page.waitForTimeout(600);
  await page.waitForSelector('#b-game[data-phase="aspetta"] .rf-box');
  check('beta: dopo anticipo si riparte dal round 1 (non da 0)', (await attr(page, '#b-game', 'data-round')) === '1' &&
    (await attr(page, '#b-game', 'data-errori')) === '1');
  check('beta: nota mostra anticipi', (await txt(page, '#b-game .game-note')).includes('anticipi: 1'));

  // aspetta il verde e tocca: turno 1 riuscito
  await page.waitForSelector('#b-game[data-phase="tocca"] .rf-box');
  check('beta: riquadro verde "TOCCA!"', (await txt(page, '#b-game .rf-box')) === 'TOCCA!' &&
    (await page.locator('#b-game .rf-box.rf-verde').count()) === 1);
  await shot(page, '47_rif_beta_tocca');
  await page.click('#b-game .rf-box');

  // altri 4 round riusciti senza altri anticipi -> fine (5 volte totali)
  await giusti(page, '#b-game', 4);
  await page.waitForSelector('#b-result:not([hidden])');
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  check('beta: risposta = inizio 0, usate 6, errori 1, 5 tempi', bc.body.p_answer.inizio === 0 && bc.body.p_answer.usate === 6 &&
    bc.body.p_answer.errori === 1 && Array.isArray(bc.body.p_answer.tempi) && bc.body.p_answer.tempi.length === 5 &&
    bc.body.p_answer.tempi.every((t) => typeof t === 'number' && t >= 0), bc.body.p_answer);
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  check('beta: mostra errori: 1', (await txt(page, '#b-result-sub')).includes('errori: 1'), await txt(page, '#b-result-sub'));
  await shot(page, '48_rif_beta_fatto');

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
  check('lun: nessun riquadro prima di Inizia', (await page.locator('#o-game .rf-box').count()) === 0);
  await shot(page, '49_rif_oggi_intro');
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="aspetta"] .rf-box');
  await giusti(page, '#o-game', 2);
  await shot(page, '50_rif_oggi_gioca');
  await tabTo(page, 'sfida'); await tabTo(page, 'oggi');
  check('lun: cambio scheda non ricomincia', (await attr(page, '#o-game', 'data-round')) === '3' &&
    (await attr(page, '#o-game', 'data-errori')) === '0');
  await giusti(page, '#o-game', 3);
  await page.waitForSelector('#o-result:not([hidden])');
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok', cg.r.ok === true && cg.body.p_answer.inizio === 0 && cg.body.p_answer.usate === 5 &&
    cg.body.p_answer.errori === 0, cg.r);
  check('lun: Fatto in 0:20.0 (tempo dalla sveglia)', (await txt(page, '#o-result-main')) === 'Fatto in 0:20.0', await txt(page, '#o-result-main'));
  await shot(page, '51_rif_oggi_fatto');

  // ===== 3. Risposta rifiutata -> nuovo tentativo (attese ridotte lato server) =====
  T.fakeNow = '2026-09-22 07:01:00+02';
  await reload(page);
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="aspetta"] .rf-box');
  const orig = (await db.query("select params from public.couple_days where day = '2026-09-22'")).rows[0].params;
  const bad = JSON.parse(JSON.stringify(orig));
  bad.attese = bad.attese.slice(0, 4);   // troppo corte: 5 turni non ci stanno più
  await db.query("update public.couple_days set params = $1 where day = '2026-09-22'", [JSON.stringify(bad)]);
  await giusti(page, '#o-game', 5);
  await page.waitForTimeout(700);
  check('mar: messaggio rifiutata', (await txt(page, '#msg')).includes('non accettata'), await txt(page, '#msg'));
  check('mar: nuovo tentativo dal round 1', (await attr(page, '#o-game', 'data-round')) === '1' &&
    (await attr(page, '#o-game', 'data-errori')) === '0', await attr(page, '#o-game', 'data-phase'));
  await db.query("update public.couple_days set params = $1 where day = '2026-09-22'", [JSON.stringify(orig)]);
  await page.waitForSelector('#o-game[data-phase="aspetta"] .rf-box');
  await giusti(page, '#o-game', 5);
  await page.waitForSelector('#o-result:not([hidden])');
  check('mar: poi registrato, Fatto in 1:00.0', (await txt(page, '#o-result-main')) === 'Fatto in 1:00.0', await txt(page, '#o-result-main'));

  check('nessun errore in console', errors.length === 0, errors);
  await finish(browser, 'UI passo 3.5');
})().catch(async (e) => { console.error(e); process.exit(2); });
