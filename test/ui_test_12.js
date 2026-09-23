// Test UI passo 3.6: Anagramma (beta + sfida vera + risposta rifiutata).
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

const attr = (page, sel, a) => page.getAttribute(sel, a);

// tocca le tessere nell'ordine giusto per completare una parola
async function solveWord(page, sel, letters) {
  for (const l of letters) {
    const tiles = await page.$$(`${sel} .ana-tile`);
    for (const t of tiles) {
      if (await t.isDisabled()) continue;
      if ((await t.textContent()) === l) { await t.click(); break; }
    }
  }
}
// completa più parole di fila, aspettando il passaggio a quella dopo
async function solveWords(page, sel, words) {
  for (let i = 0; i < words.length; i++) {
    await solveWord(page, sel, words[i]);
    if (i < words.length - 1) await page.waitForSelector(`${sel}[data-parola="${i + 2}"]`);
  }
}
// tocca una tessera sbagliata (diversa dalla prossima lettera attesa)
async function sbaglia(page, sel, nextLetter) {
  const tiles = await page.$$(`${sel} .ana-tile`);
  for (const t of tiles) {
    if (await t.isDisabled()) continue;
    const l = await t.textContent();
    if (l !== nextLetter) { await t.click(); return l; }
  }
  return null;
}

(async () => {
  const browser = await start();
  const { A, B } = await setupCouple();
  T.fakeNow = '2026-09-20 10:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');

  // ===== 1. Beta =====
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: Anagramma giocabile', await visible(page, 'button[data-code="anagramma"]'));
  await page.click('button[data-code="anagramma"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  const intro = await txt(page, '#b-game');
  check('beta: spiegazione 5 parole + lettere', intro.includes('5 parole') && intro.includes('lettere'), intro);
  check('beta: niente tessere prima di Inizia', (await page.locator('#b-game .ana-tile').count()) === 0);
  await shot(page, '59_ana_beta_intro');
  await page.click('#b-game .game-start');
  await page.waitForSelector('#b-game[data-phase="gioca"] .ana-tile');
  const P = log.filter((x) => x.fn === 'beta_start').pop().r.parametri;
  const S = P.sequenze;
  check('beta: tessere = lunghezza della parola 1', (await page.locator('#b-game .ana-tile').count()) === S[0][0].length);
  check('beta: stesse lettere della parola, mescolate', (await page.$$eval('#b-game .ana-tile', (ts) => ts.map((t) => t.textContent))).slice().sort().join('') ===
    S[0][0].slice().sort().join(''), S[0][0]);
  check('beta: Parola 1 di 5', (await txt(page, '#b-game .game-note')) === 'Parola 1 di 5');
  await shot(page, '60_ana_beta_parola1');

  // tocco sbagliato: lampeggia, nessuna ripartenza (tentativi illimitati)
  const wrongL = await sbaglia(page, '#b-game', S[0][0][0]);
  check('beta: errore lampeggia rosso', wrongL !== null && (await page.locator('#b-game .ana-tile.ana-wrong').count()) === 1);
  await shot(page, '61_ana_beta_errore');
  await page.waitForTimeout(400);
  check('beta: lampeggio finito dopo 0,3 s', (await page.locator('#b-game .ana-wrong').count()) === 0);
  check('beta: nessuna casella riempita dopo l\'errore', (await page.locator('#b-game .ana-slot.ok').count()) === 0);
  check('beta: stessa parola, stesso tentativo (nessuna ripartenza)',
    (await attr(page, '#b-game', 'data-parola')) === '1' && (await attr(page, '#b-game', 'data-tentativo')) === '1');

  // risolvi le 5 parole
  await solveWords(page, '#b-game', S[0]);
  await page.waitForSelector('#b-result:not([hidden])');
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  check('beta: risposta = tentativo 0, le 5 parole, tentativi 1',
    JSON.stringify(bc.body.p_answer) === JSON.stringify({ tentativo: 0, risposte: S[0], tentativi: 1 }), bc.body.p_answer);
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  await shot(page, '62_ana_beta_fatto');

  // ===== 2. Sfida vera =====
  await db.query("update public.challenge_types set enabled = (code = 'anagramma'), game_live = (code = 'anagramma')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  T.fakeNow = '2026-09-21 07:00:20+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('lun: challenge Anagramma', (await txt(page, '#o-ch-name')) === 'Anagramma');
  check('lun: niente Fatto', !(await visible(page, '#b-done')));
  check('lun: niente tessere prima di Inizia', (await page.locator('#o-game .ana-tile').count()) === 0);
  await shot(page, '63_ana_oggi_intro');
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="gioca"] .ana-tile');
  const SO = (await db.query("select params from public.couple_days where day = '2026-09-21'")).rows[0].params.sequenze;
  await solveWord(page, '#o-game', SO[0][0]);
  await page.waitForSelector('#o-game[data-parola="2"]');
  await shot(page, '64_ana_oggi_gioca');
  await tabTo(page, 'sfida'); await tabTo(page, 'oggi');
  check('lun: cambio scheda non ricomincia', (await attr(page, '#o-game', 'data-parola')) === '2' &&
    (await attr(page, '#o-game', 'data-tentativo')) === '1');
  for (let i = 1; i < 5; i++) {
    await solveWord(page, '#o-game', SO[0][i]);
    if (i < 4) await page.waitForSelector(`#o-game[data-parola="${i + 2}"]`);
  }
  await page.waitForSelector('#o-result:not([hidden])');
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok', cg.r.ok === true && cg.body.p_answer.tentativo === 0 && cg.body.p_answer.risposte.length === 5, cg.r);
  check('lun: Fatto in 0:20.0 (tempo dalla sveglia)', (await txt(page, '#o-result-main')) === 'Fatto in 0:20.0', await txt(page, '#o-result-main'));
  await shot(page, '65_ana_oggi_fatto');

  // ===== 3. Risposta rifiutata -> nuovo tentativo con parole nuove =====
  T.fakeNow = '2026-09-22 07:01:00+02';
  await reload(page);
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="gioca"] .ana-tile');
  const orig = (await db.query("select params from public.couple_days where day = '2026-09-22'")).rows[0].params;
  const bad = JSON.parse(JSON.stringify(orig));
  bad.sequenze[0][4] = bad.sequenze[0][4].slice().reverse();
  await db.query("update public.couple_days set params = $1 where day = '2026-09-22'", [JSON.stringify(bad)]);
  await solveWords(page, '#o-game', orig.sequenze[0]);
  await page.waitForTimeout(700);
  check('mar: messaggio rifiutata', (await txt(page, '#msg')).includes('non accettata'), await txt(page, '#msg'));
  check('mar: nuovo tentativo dalla parola 1 con la sequenza 2',
    (await attr(page, '#o-game', 'data-parola')) === '1' && (await attr(page, '#o-game', 'data-tentativo')) === '2');
  await db.query("update public.couple_days set params = $1 where day = '2026-09-22'", [JSON.stringify(orig)]);
  await solveWords(page, '#o-game', orig.sequenze[1]);
  await page.waitForSelector('#o-result:not([hidden])');
  check('mar: poi registrato, Fatto in 1:00.0', (await txt(page, '#o-result-main')) === 'Fatto in 1:00.0', await txt(page, '#o-result-main'));

  check('nessun errore in console', errors.length === 0, errors);
  await finish(browser, 'UI passo 3.6');
})().catch(async (e) => { console.error(e); process.exit(2); });
