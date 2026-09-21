// Test UI passo 3.1: pagina di prova (beta) + Memoria nella sfida vera.
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

// legge la sequenza mostrata (fase "guarda") nel contenitore sel
async function readSeq(page, sel) {
  await page.waitForSelector(`${sel}[data-phase="guarda"] .mem-card`);
  return page.$$eval(`${sel} .mem-card`, (cs) => cs.map((c) => Number(c.dataset.s)));
}
async function waitPhase(page, sel, phase) {
  await page.waitForSelector(`${sel}[data-phase="${phase}"]`, { timeout: 8000 });
}
async function tapSeq(page, sel, seq) {
  for (const s of seq) await page.click(`${sel} .mem-key[data-s="${s}"]`);
}

(async () => {
  const browser = await start();
  const { A, B } = await setupCouple();

  // ===== 1. Beta senza accesso =====
  {
    const { page, ctx } = await openApp(browser, null);
    await page.goto('http://localhost:8765/beta.html');
    await page.waitForTimeout(500);
    check('beta senza accesso: invito ad accedere', await visible(page, '#b-login'));
    check('beta senza accesso: niente elenco', !(await visible(page, '#b-list')));
    await ctx.close();
  }

  // ===== 2. Beta con accesso =====
  T.fakeNow = '2026-09-20 10:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: 12 giochi in elenco', (await page.locator('#b-games li').count()) === 12);
  check('beta: solo Memoria provabile', (await page.locator('#b-games button').count()) === 1 &&
    (await page.locator('#b-games button[data-code="memoria"]').count()) === 1);
  check('beta: altri "in arrivo"', (await page.locator('#b-games .tag:text("in arrivo")').count()) === 11);
  await shot(page, '10_beta_elenco');

  await page.click('button[data-code="memoria"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  check('beta: titolo Memoria', (await txt(page, '#b-name')) === 'Memoria');
  check('beta: spiegazione', (await txt(page, '#b-game')).includes('5 secondi'));
  await shot(page, '11_beta_inizia');
  await page.click('#b-game .game-start');
  const seq1 = await readSeq(page, '#b-game');
  check('beta: 6 simboli diversi', seq1.length === 6 && new Set(seq1).size === 6, seq1);
  check('beta: tentativo 1', (await page.getAttribute('#b-game', 'data-tentativo')) === '1');
  await shot(page, '12_beta_guarda');
  await page.waitForTimeout(1500);
  check('beta: dopo 1,5 s ancora visibili', (await page.getAttribute('#b-game', 'data-phase')) === 'guarda');
  await waitPhase(page, '#b-game', 'ripeti');
  check('beta: simboli nascosti', (await page.locator('#b-game .mem-slot').count()) === 6 &&
    (await page.locator('#b-game .mem-slot.ok').count()) === 0);
  check('beta: 9 tasti', (await page.locator('#b-game .mem-key').count()) === 9);
  // primo giusto, secondo sbagliato
  await page.click(`#b-game .mem-key[data-s="${seq1[0]}"]`);
  check('beta: primo giusto riempie una casella', (await page.locator('#b-game .mem-slot.ok').count()) === 1);
  const wrong = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((x) => x !== seq1[1] && x !== seq1[0]);
  await page.click(`#b-game .mem-key[data-s="${wrong}"]`);
  check('beta: errore segnalato', (await txt(page, '#b-game .game-note')).includes('Sbagliato'));
  await shot(page, '13_beta_errore');
  const seq2 = await readSeq(page, '#b-game');
  check('beta: nuova sequenza, tentativo 2', (await page.getAttribute('#b-game', 'data-tentativo')) === '2');
  await waitPhase(page, '#b-game', 'ripeti');
  await tapSeq(page, '#b-game', seq2);
  await page.waitForSelector('#b-result:not([hidden])');
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  check('beta: risposta mandata al server', bc && bc.body.p_answer.tentativo === 1 && JSON.stringify(bc.body.p_answer.sequenza) === JSON.stringify(seq2), bc && bc.body.p_answer);
  check('beta: verificata dal server', bc && bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  check('beta: tentativi 2', (await txt(page, '#b-result-sub')).includes('tentativi: 2'));
  const tb = await txt(page, '#b-timer');
  check('beta: cronometro fermo ~11-14 s', /^0:1[1-4]\.\d$/.test(tb), tb);
  await shot(page, '14_beta_fatto');
  await page.waitForTimeout(400);
  check('beta: cronometro fermo', (await txt(page, '#b-timer')) === tb);
  await page.click('#b-again');
  await page.waitForSelector('#b-game .game-start');
  check('beta: rigioca riparte', (await txt(page, '#b-timer')).startsWith('0:00'));
  await page.click('#b-back');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: torna all elenco', !(await visible(page, '#b-play')));

  // ===== 3. Link dal Profilo =====
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await tabTo(page, 'profilo');
  check('profilo: link prova giochi', (await page.getAttribute('#l-beta', 'href')) === 'beta.html' && await visible(page, '#l-beta'));
  await shot(page, '15_profilo_link_beta');

  // ===== 4. Sfida vera con Memoria attiva =====
  await db.query("update public.challenge_types set enabled = (code = 'memoria'), game_live = (code = 'memoria')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });

  T.fakeNow = '2026-09-21 07:00:20+02';
  await tabTo(page, 'oggi'); await reload(page);
  check('lun: challenge Memoria', (await txt(page, '#o-ch-name')) === 'Memoria');
  check('lun: gioco visibile', await visible(page, '#o-game .game-start'));
  check('lun: niente pulsante Fatto', !(await visible(page, '#b-done')));
  check('lun: niente testo "arriva più avanti"', !(await txt(page, '#o-ch-detail')).includes('più avanti'));
  await shot(page, '16_oggi_memoria_inizia');
  await page.click('#o-game .game-start');
  const s1 = await readSeq(page, '#o-game');
  await shot(page, '17_oggi_memoria_guarda');
  await waitPhase(page, '#o-game', 'ripeti');
  // cambio scheda a metà: il gioco non deve ripartire
  await tabTo(page, 'sfida'); await tabTo(page, 'oggi');
  await page.waitForTimeout(500);
  check('lun: gioco non ricomincia cambiando scheda', (await page.getAttribute('#o-game', 'data-phase')) === 'ripeti');
  await tapSeq(page, '#o-game', s1.slice(0, 3));
  await shot(page, '18_oggi_memoria_ripeti');
  await tapSeq(page, '#o-game', s1.slice(3));
  await page.waitForSelector('#o-result:not([hidden])');
  check('lun: registrato', (await txt(page, '#msg')).includes('Registrato: 0:20.0'), await txt(page, '#msg'));
  check('lun: Fatto in 0:20.0', (await txt(page, '#o-result-main')) === 'Fatto in 0:20.0');
  check('lun: gioco smontato', !(await visible(page, '#o-game')));
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok', cg && cg.r.ok === true, cg && cg.r);
  await shot(page, '19_oggi_memoria_fatto');

  // ===== 5. Risposta rifiutata dal server -> nuova sequenza, poi ok =====
  T.fakeNow = '2026-09-22 07:01:00+02';
  await reload(page);
  await page.click('#o-game .game-start');
  const s2 = await readSeq(page, '#o-game');
  // il server cambia le sequenze: la risposta del telefono non combacia più
  await db.query("update public.couple_days set params = jsonb_set(params, '{sequenze,0}', '[8,7,6,5,4,3]') where day = '2026-09-22'");
  if (JSON.stringify(s2) === '[8,7,6,5,4,3]') await db.query("update public.couple_days set params = jsonb_set(params, '{sequenze,0}', '[0,1,2,3,4,5]') where day = '2026-09-22'");
  await waitPhase(page, '#o-game', 'ripeti');
  await tapSeq(page, '#o-game', s2);
  await page.waitForTimeout(600);
  check('mar: messaggio risposta rifiutata', (await txt(page, '#msg')).includes('non accettata'), await txt(page, '#msg'));
  check('mar: nuova sequenza (tentativo 2)', (await page.getAttribute('#o-game', 'data-tentativo')) === '2');
  check('mar: ancora in corso', await visible(page, '#o-play'));
  await reload(page);
  await page.click('#o-game .game-start');
  const s3 = await readSeq(page, '#o-game');
  await waitPhase(page, '#o-game', 'ripeti');
  await tapSeq(page, '#o-game', s3);
  await page.waitForSelector('#o-result:not([hidden])');
  check('mar: poi registrato', (await txt(page, '#o-result-main')) === 'Fatto in 1:00.0', await txt(page, '#o-result-main'));

  // ===== 6. Challenge senza gioco pronto: resta il Fatto =====
  await db.query("update public.challenge_types set enabled = (code = 'numeri')");
  T.fakeNow = '2026-09-23 07:00:10+02';
  await reload(page);
  check('mer: Numeri con pulsante Fatto', (await txt(page, '#o-ch-name')) === 'Numeri in ordine' && await visible(page, '#b-done'));
  check('mer: niente gioco', !(await visible(page, '#o-game')));
  check('mer: testo "arriva più avanti"', (await txt(page, '#o-ch-detail')).includes('più avanti'));
  await page.click('#b-done'); await page.waitForTimeout(500);
  check('mer: Fatto registrato', (await txt(page, '#o-result-main')) === 'Fatto in 0:10.0');

  // ===== 7. Beta mostra "attivo nella sfida" =====
  await db.query("update public.challenge_types set enabled = true");
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: Memoria attiva nella sfida', (await page.locator('#b-games li:has(button[data-code="memoria"]) .tag.on').count()) === 1);

  check('nessun errore in console', errors.length === 0, errors);
  await finish(browser, 'UI passo 3');
})().catch(async (e) => { console.error(e); process.exit(2); });
