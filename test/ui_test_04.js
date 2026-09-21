// Test UI passo 3.1b: Memoria a 5 round da 3 (beta + sfida vera + giornata vecchia).
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

async function readSeq(page, sel, round) {
  const r = round ? `[data-round="${round}"]` : '';
  await page.waitForSelector(`${sel}[data-phase="guarda"]${r} .mem-card`, { timeout: 8000 });
  return page.$$eval(`${sel} .mem-card`, (cs) => cs.map((c) => Number(c.dataset.s)));
}
async function waitPhase(page, sel, phase) {
  await page.waitForSelector(`${sel}[data-phase="${phase}"]`, { timeout: 8000 });
}
async function tapSeq(page, sel, seq) {
  for (const s of seq) await page.click(`${sel} .mem-key[data-s="${s}"]`);
}
// gioca un round giusto; restituisce la sequenza
async function playRound(page, sel, round) {
  const seq = await readSeq(page, sel, round);
  await waitPhase(page, sel, 'ripeti');
  await tapSeq(page, sel, seq);
  return seq;
}
const attr = (page, sel, a) => page.getAttribute(sel, a);

(async () => {
  const browser = await start();
  const { A, B } = await setupCouple();
  T.fakeNow = '2026-09-20 10:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');

  // ===== 1. Beta =====
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  await page.click('button[data-code="memoria"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  const intro = await txt(page, '#b-game');
  check('beta: spiegazione 5 round / 3 secondi / round 1', intro.includes('5 round') && intro.includes('3 secondi') && intro.includes('round 1'), intro);
  check('beta: nota cronometro', (await txt(page, '#b-play')).includes('Nella sfida vera parte all\'orario della sveglia'));
  await shot(page, '20_beta_intro');

  await page.click('#b-game .game-start');
  const r1 = await readSeq(page, '#b-game', 1);
  check('beta: 3 simboli diversi', r1.length === 3 && new Set(r1).size === 3, r1);
  check('beta: round 1 di 5', (await txt(page, '#b-game .game-note')).includes('Round 1 di 5'));
  check('beta: 5 pallini, 1 in corso', (await page.locator('#b-game .mem-dots span').count()) === 5 &&
    (await page.locator('#b-game .mem-dots span.now').count()) === 1);
  await shot(page, '21_beta_guarda');
  await page.waitForTimeout(2000);
  check('beta: dopo 2 s ancora visibili', (await attr(page, '#b-game', 'data-phase')) === 'guarda');
  await waitPhase(page, '#b-game', 'ripeti');
  check('beta: 3 caselle vuote + 9 tasti', (await page.locator('#b-game .mem-slot').count()) === 3 &&
    (await page.locator('#b-game .mem-key').count()) === 9);
  await tapSeq(page, '#b-game', r1.slice(0, 2));
  await shot(page, '22_beta_ripeti');
  await tapSeq(page, '#b-game', r1.slice(2));
  check('beta: round 1 fatto', (await txt(page, '#b-game .game-note')).includes('Round 1 fatto'));
  // round 2 parte da solo; errore al secondo tocco
  const r2 = await readSeq(page, '#b-game', 2);
  check('beta: round 2 parte da solo', (await txt(page, '#b-game .game-note')).includes('Round 2 di 5'));
  check('beta: 1 pallino pieno', (await page.locator('#b-game .mem-dots span.done').count()) === 1);
  await shot(page, '23_beta_round2');
  await waitPhase(page, '#b-game', 'ripeti');
  await page.click(`#b-game .mem-key[data-s="${r2[0]}"]`);
  const wrong = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((x) => !r2.includes(x));
  await page.click(`#b-game .mem-key[data-s="${wrong}"]`);
  check('beta: errore -> si riparte dal round 1', (await txt(page, '#b-game .game-note')).includes('Si riparte dal round 1'));
  await shot(page, '24_beta_errore');
  // si riparte: round 1, tentativo 2, sequenze nuove (dalla terza in poi)
  await readSeq(page, '#b-game', 1);
  check('beta: di nuovo round 1, tentativo 2', (await attr(page, '#b-game', 'data-round')) === '1' && (await attr(page, '#b-game', 'data-tentativo')) === '2');
  check('beta: nessun pallino pieno', (await page.locator('#b-game .mem-dots span.done').count()) === 0);
  const played = [];
  for (let r = 1; r <= 5; r++) played.push(await playRound(page, '#b-game', r));
  await page.waitForSelector('#b-result:not([hidden])');
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  const P = log.filter((x) => x.fn === 'beta_start').pop().r.parametri;
  check('beta: risposta inizio 2 + 5 sequenze giocate', bc.body.p_answer.inizio === 2 &&
    JSON.stringify(bc.body.p_answer.sequenze) === JSON.stringify(played) &&
    JSON.stringify(played) === JSON.stringify(P.sequenze.slice(2, 7)), bc.body.p_answer);
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  check('beta: tentativi 2', (await txt(page, '#b-result-sub')).includes('tentativi: 2'), await txt(page, '#b-result-sub'));
  const tb = await txt(page, '#b-timer');
  check('beta: cronometro fermo ~25-40 s', /^0:(2[5-9]|3\d)\.\d$/.test(tb), tb);
  await shot(page, '25_beta_fatto');

  // ===== 2. Sfida vera =====
  await db.query("update public.challenge_types set enabled = (code = 'memoria'), game_live = (code = 'memoria')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  T.fakeNow = '2026-09-21 07:00:20+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('lun: challenge Memoria', (await txt(page, '#o-ch-name')) === 'Memoria');
  check('lun: cronometro già a 0:20 prima di Inizia', (await txt(page, '#o-timer')).startsWith('0:20'), await txt(page, '#o-timer'));
  check('lun: avviso cronometro dalla sveglia', (await txt(page, '#o-ch-detail')).includes('partito all\'orario della sveglia'));
  check('lun: niente Fatto', !(await visible(page, '#b-done')));
  await shot(page, '26_oggi_intro');
  await page.click('#o-game .game-start');
  await readSeq(page, '#o-game', 1);
  await shot(page, '27_oggi_guarda');
  // cambio scheda a metà partita: non ricomincia
  await waitPhase(page, '#o-game', 'ripeti');
  await tabTo(page, 'sfida'); await tabTo(page, 'oggi');
  check('lun: cambio scheda non ricomincia', (await attr(page, '#o-game', 'data-phase')) === 'ripeti' && (await attr(page, '#o-game', 'data-round')) === '1');
  const s1 = await page.$$eval('#o-game .mem-slot', (x) => x.length);
  check('lun: 3 caselle', s1 === 3);
  const T1 = log.filter((x) => x.fn === 'get_today').pop().r.io.challenge.parametri.sequenze;
  await tapSeq(page, '#o-game', T1[0]);
  for (let r = 2; r <= 5; r++) await playRound(page, '#o-game', r);
  await page.waitForSelector('#o-result:not([hidden])');
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok, inizio 0', cg.r.ok === true && cg.body.p_answer.inizio === 0, cg.body.p_answer);
  check('lun: Fatto in 0:20.0 (tempo dalla sveglia)', (await txt(page, '#o-result-main')) === 'Fatto in 0:20.0', await txt(page, '#o-result-main'));
  await shot(page, '28_oggi_fatto');

  // ===== 3. Risposta rifiutata dal server -> si riparte con simboli nuovi =====
  T.fakeNow = '2026-09-22 07:01:00+02';
  await reload(page);
  await page.click('#o-game .game-start');
  await readSeq(page, '#o-game', 1);
  // il server cambia la sequenza del round 3: la risposta del telefono non combacia più
  await db.query("update public.couple_days set params = jsonb_set(params, '{sequenze,2}', '[8,7,6]') where day = '2026-09-22'");
  await db.query("update public.couple_days set params = jsonb_set(params, '{sequenze,2}', '[0,1,2]') where day = '2026-09-22' and params->'sequenze'->3 = '[0,1,2]'");
  await waitPhase(page, '#o-game', 'ripeti');
  const T2 = log.filter((x) => x.fn === 'get_today').pop().r.io.challenge.parametri.sequenze;
  await tapSeq(page, '#o-game', T2[0]);
  for (let r = 2; r <= 5; r++) await playRound(page, '#o-game', r);
  await page.waitForTimeout(700);
  check('mar: messaggio rifiutata', (await txt(page, '#msg')).includes('non accettata'), await txt(page, '#msg'));
  check('mar: nuova partita round 1, tentativo 2', (await attr(page, '#o-game', 'data-round')) === '1' && (await attr(page, '#o-game', 'data-tentativo')) === '2');
  for (let r = 1; r <= 5; r++) await playRound(page, '#o-game', r);
  await page.waitForSelector('#o-result:not([hidden])');
  const cg2 = log.filter((x) => x.fn === 'complete_game').pop();
  check('mar: poi registrato (inizio 5)', cg2.r.ok === true && cg2.body.p_answer.inizio === 5, cg2.body.p_answer);
  check('mar: Fatto in 1:00.0', (await txt(page, '#o-result-main')) === 'Fatto in 1:00.0');

  // ===== 4. Giornata creata prima del 04 (Memoria vecchia, 6 simboli) =====
  const cp = (await db.query('select couple_id from public.couple_members limit 1')).rows[0].couple_id;
  await db.query("insert into public.couple_days (couple_id, day, challenge, params) values ($1, '2026-09-23', 'memoria', $2)",
    [cp, JSON.stringify({ gioco: 'memoria', simboli: 9, mostra_ms: 5000, sequenze: [[0, 1, 2, 3, 4, 5], [8, 7, 6, 5, 4, 3]] })]);
  T.fakeNow = '2026-09-23 07:00:30+02';
  await reload(page);
  check('mer (vecchia): spiegazione 6 simboli', (await txt(page, '#o-game')).includes('6 simboli'));
  await page.click('#o-game .game-start');
  const old = await readSeq(page, '#o-game');
  check('mer (vecchia): 6 simboli, niente pallini', old.length === 6 && (await page.locator('#o-game .mem-dots').count()) === 0, old);
  await shot(page, '29_oggi_vecchia');
  await waitPhase(page, '#o-game', 'ripeti');
  await tapSeq(page, '#o-game', old);
  await page.waitForSelector('#o-result:not([hidden])');
  const cg3 = log.filter((x) => x.fn === 'complete_game').pop();
  check('mer (vecchia): registrato col formato vecchio', cg3.r.ok === true && cg3.body.p_answer.tentativo === 0, cg3.body.p_answer);

  check('nessun errore in console', errors.length === 0, errors);
  await finish(browser, 'UI passo 3.1b');
})().catch(async (e) => { console.error(e); process.exit(2); });
