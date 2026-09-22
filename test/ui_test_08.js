// Test UI passo 3.4: Trova l'intruso (beta + sfida vera + risposta rifiutata).
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

const SYM = ['🍎', '🐶', '⭐', '🚗', '🌙', '🎈', '🔑', '🐟', '🌵'];
const attr = (page, sel, a) => page.getAttribute(sel, a);

async function waitPhase(page, sel, phase, turno) {
  const t = turno ? `[data-turno="${turno}"]` : '';
  await page.waitForSelector(`${sel}[data-phase="${phase}"]${t}`, { timeout: 8000 });
}
async function readGrid(page, sel) {
  return page.$$eval(`${sel} .int-cell`, (cs) => cs.map((c) => c.textContent));
}
async function tapPos(page, sel, pos) {
  await page.click(`${sel} .int-cell[data-pos="${pos}"]`);
}
// gioca un turno giusto: la posizione la sappiamo già dai parametri del server
async function playTurn(page, sel, turn, pos) {
  await waitPhase(page, sel, 'guarda', turn);
  await waitPhase(page, sel, 'tocca', turn);
  await tapPos(page, sel, pos);
}
async function playAll(page, sel, seq) {
  for (let i = 0; i < seq.length; i++) await playTurn(page, sel, i + 1, seq[i][2]);
}

(async () => {
  const browser = await start();
  const { A, B } = await setupCouple();
  T.fakeNow = '2026-09-20 10:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');

  // ===== 1. Beta =====
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: Trova l\'intruso giocabile', await visible(page, 'button[data-code="intruso"]'));
  await page.click('button[data-code="intruso"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  const intro = await txt(page, '#b-game');
  check('beta: spiegazione emoji + errore', intro.includes('5 turni') && intro.includes('turno 1'), intro);
  check('beta: griglia coperta prima di Inizia', (await page.locator('#b-game .int-cell').count()) === 0);
  await shot(page, '45_int_beta_intro');
  await page.click('#b-game .game-start');
  await waitPhase(page, '#b-game', 'guarda', 1);
  const P = log.filter((x) => x.fn === 'beta_start').pop().r.parametri;
  const S = P.sequenze;
  const t0 = S[0][0];
  const g1 = await readGrid(page, '#b-game');
  check('beta: 9 caselle nel turno 1', g1.length === 9, g1);
  check('beta: emoji mostrate = base/intruso del server', g1.every((s, i) => s === SYM[i === t0[2] ? t0[1] : t0[0]]), g1);
  check('beta: 8 emoji uguali + 1 diversa alla posizione giusta', new Set(g1.filter((_, i) => i !== t0[2])).size === 1 &&
    g1[t0[2]] !== g1[(t0[2] + 1) % 9], g1);
  check('beta: Turno 1 di 5', (await txt(page, '#b-game .game-note')).includes('Turno 1 di 5'));
  check('beta: 5 pallini, 1 in corso', (await page.locator('#b-game .int-dots span').count()) === 5 &&
    (await page.locator('#b-game .int-dots span.int-now').count()) === 1);
  await shot(page, '46_int_beta_guarda');
  await page.waitForTimeout(2000);
  check('beta: dopo 2 s ancora visibile', (await attr(page, '#b-game', 'data-phase')) === 'guarda');
  await waitPhase(page, '#b-game', 'tocca', 1);
  check('beta: griglia coperta, 9 caselle toccabili', (await page.locator('#b-game .int-cell.int-copri').count()) === 9);
  await shot(page, '47_int_beta_tocca');
  await tapPos(page, '#b-game', t0[2]);
  check('beta: turno 1 fatto', (await txt(page, '#b-game .game-note')).includes('Turno 1 fatto'));
  // turno 2 parte da solo; errore al tocco
  await waitPhase(page, '#b-game', 'guarda', 2);
  check('beta: turno 2 parte da solo', (await txt(page, '#b-game .game-note')).includes('Turno 2 di 5'));
  check('beta: 1 pallino pieno', (await page.locator('#b-game .int-dots span.int-ok').count()) === 1);
  await shot(page, '48_int_beta_turno2');
  const t1 = S[0][1];
  await waitPhase(page, '#b-game', 'tocca', 2);
  const wrong = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((x) => x !== t1[2]);
  await tapPos(page, '#b-game', wrong);
  check('beta: errore -> si riparte dal turno 1', (await txt(page, '#b-game .game-note')).includes('riparte dal turno 1'));
  await shot(page, '49_int_beta_errore');
  // si riparte: turno 1, tentativo 2, sequenza nuova (S[1])
  await waitPhase(page, '#b-game', 'guarda', 1);
  check('beta: di nuovo turno 1, tentativo 2', (await attr(page, '#b-game', 'data-tentativo')) === '2');
  check('beta: nessun pallino pieno', (await page.locator('#b-game .int-dots span.int-ok').count()) === 0);
  await playAll(page, '#b-game', S[1]);
  await page.waitForSelector('#b-result:not([hidden])');
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  check('beta: risposta tentativo 1 + 5 posizioni, tentativi 2', JSON.stringify(bc.body.p_answer) ===
    JSON.stringify({ tentativo: 1, risposte: S[1].map((t) => t[2]), tentativi: 2 }), bc.body.p_answer);
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  check('beta: mostra tentativi: 2', (await txt(page, '#b-result-sub')).includes('tentativi: 2'), await txt(page, '#b-result-sub'));
  await shot(page, '50_int_beta_fatto');

  // ===== 2. Sfida vera =====
  await db.query("update public.challenge_types set enabled = (code = 'intruso'), game_live = (code = 'intruso')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  T.fakeNow = '2026-09-21 07:00:20+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('lun: challenge Trova l\'intruso', (await txt(page, '#o-ch-name')) === "Trova l'intruso");
  check('lun: niente Fatto', !(await visible(page, '#b-done')));
  check('lun: griglia coperta', (await page.locator('#o-game .int-cell').count()) === 0);
  await shot(page, '51_int_oggi_intro');
  await page.click('#o-game .game-start');
  const T1 = log.filter((x) => x.fn === 'get_today').pop().r.io.challenge.parametri.sequenze;
  await playTurn(page, '#o-game', 1, T1[0][0][2]);
  await shot(page, '52_int_oggi_gioca');
  await waitPhase(page, '#o-game', 'guarda', 2);
  await tabTo(page, 'sfida'); await tabTo(page, 'oggi');
  check('lun: cambio scheda non ricomincia', (await attr(page, '#o-game', 'data-turno')) === '2' &&
    (await attr(page, '#o-game', 'data-tentativo')) === '1');
  await waitPhase(page, '#o-game', 'tocca', 2);
  await tapPos(page, '#o-game', T1[0][1][2]);
  for (let i = 2; i < 5; i++) await playTurn(page, '#o-game', i + 1, T1[0][i][2]);
  await page.waitForSelector('#o-result:not([hidden])');
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok, tentativo 0', cg.r.ok === true && cg.body.p_answer.tentativo === 0 &&
    cg.body.p_answer.risposte.length === 5, cg.r);
  check('lun: Fatto in 0:20.0 (tempo dalla sveglia)', (await txt(page, '#o-result-main')) === 'Fatto in 0:20.0', await txt(page, '#o-result-main'));
  await shot(page, '53_int_oggi_fatto');

  // ===== 3. Risposta rifiutata -> nuovo tentativo con emoji nuove =====
  T.fakeNow = '2026-09-22 07:01:00+02';
  await reload(page);
  await page.click('#o-game .game-start');
  const orig = (await db.query("select params from public.couple_days where day = '2026-09-22'")).rows[0].params;
  const bad = JSON.parse(JSON.stringify(orig));
  bad.sequenze[0][4][2] = (bad.sequenze[0][4][2] + 1) % 9;
  await db.query("update public.couple_days set params = $1 where day = '2026-09-22'", [JSON.stringify(bad)]);
  await playAll(page, '#o-game', orig.sequenze[0]);
  await page.waitForTimeout(700);
  check('mar: messaggio rifiutata', (await txt(page, '#msg')).includes('non accettata'), await txt(page, '#msg'));
  check('mar: nuovo tentativo dal turno 1 con la sequenza 2', (await attr(page, '#o-game', 'data-turno')) === '1' &&
    (await attr(page, '#o-game', 'data-tentativo')) === '2');
  await db.query("update public.couple_days set params = $1 where day = '2026-09-22'", [JSON.stringify(orig)]);
  await playAll(page, '#o-game', orig.sequenze[1]);
  await page.waitForSelector('#o-result:not([hidden])');
  check('mar: poi registrato, Fatto in 1:00.0', (await txt(page, '#o-result-main')) === 'Fatto in 1:00.0', await txt(page, '#o-result-main'));

  check('nessun errore in console', errors.length === 0, errors);
  await finish(browser, 'UI passo 3.4');
})().catch(async (e) => { console.error(e); process.exit(2); });
