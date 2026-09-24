// Test UI passo 3.12: Esercizi (beta + fotocamera negata + sfida vera).
// Sesto (e ultimo) gioco con fotocamera, FRONTALE come Occhi aperti e in
// modalità record:true (games.js): niente analisi dei frame. A DIFFERENZA
// di Occhi aperti la registrazione NON si ferma da sola dopo un tempo
// fisso: un pulsante "Fine registrazione" la ferma quando la persona lo
// tocca (il testo mostra i secondi TRASCORSI, non un countdown), e il
// gioco finisce subito, {fatto:true} (il video viaggia a parte,
// save_exercise_video, mai in beta). Dal Passo 4 (video a richiesta) il
// video si scarica solo al tocco di "Guarda video" (get_exercise_video) e
// resta visibile solo per la giornata di gioco, esattamente come "Occhi
// aperti" (non più 48 ore piene dalla registrazione).
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, setupCouple, start, finish } = require('./ui_lib');

const EXERCISE_NAMES = {
  piegamenti_10: '10 piegamenti', squat_20: '20 squat', affondi_20: '20 affondi', plank_30: 'plank per 30 secondi',
};

async function hideDoc(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { get: () => h, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

(async () => {
  const browser = await start({ camera: true });
  const { A, B } = await setupCouple();
  T.fakeNow = '2026-09-20 10:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');

  // ===== 1. Beta =====
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: Esercizi giocabile', await visible(page, 'button[data-code="esercizi"]'));
  await page.click('button[data-code="esercizi"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  const bs = log.filter((x) => x.fn === 'beta_start' && x.body.p_code === 'esercizi').pop();
  const esercizio = bs.r.parametri.esercizio;
  check('beta_start: esercizio tra i 4 validi', Object.prototype.hasOwnProperty.call(EXERCISE_NAMES, esercizio), esercizio);
  check('beta_start: secondi_max 180 (rete di sicurezza, non un countdown fisso)', bs.r.parametri.secondi_max, 180);
  const intro = await txt(page, '#b-game');
  check('beta: spiegazione fotocamera frontale + nome esercizio + Fine registrazione',
    intro.toLowerCase().includes('frontale') && intro.includes(EXERCISE_NAMES[esercizio]) && intro.includes('Fine registrazione'), intro);
  await shot(page, '105_esercizi_beta_intro');
  await page.click('#b-game .game-start');
  await page.waitForSelector('#b-game[data-phase="gioca"] video', { timeout: 15000 });
  check('beta: video in diretta (anteprima mentre ci si allena)', await page.locator('#b-game video').isVisible());
  check('beta: niente barra (solo il testo dei secondi)', (await page.locator('#b-game .cam-bar').count()) === 0);
  const titolo = EXERCISE_NAMES[esercizio];
  const titoloAtteso = titolo.charAt(0).toUpperCase() + titolo.slice(1);
  check('beta: titolo con il nome dell\'esercizio da svolgere', await txt(page, '#b-game .game-title'), titoloAtteso);
  await page.waitForSelector('#b-game .game-note:has-text("Registrazione: 0 s")', { timeout: 5000 });
  check('beta: pulsante "Fine registrazione" presente (fermata manuale, non un countdown)', await visible(page, '#b-game button:has-text("Fine registrazione")'));
  await shot(page, '106_esercizi_beta_gioca');

  // il testo conta i secondi TRASCORSI (in su), non un countdown come Occhi aperti
  await page.waitForSelector('#b-game .game-note:has-text("Registrazione: 1 s")', { timeout: 3000 });
  await page.waitForSelector('#b-game .game-note:has-text("Registrazione: 2 s")', { timeout: 3000 });

  // perdita di focus a registrazione in corso -> si scarta e riparte da zero
  // (stesso meccanismo di Occhi aperti, riusato qui: verifica che la nuova
  // modalità a fermata manuale non l'abbia rotto)
  await hideDoc(page, true);
  await page.waitForTimeout(400);
  await hideDoc(page, false);
  await page.waitForSelector('#b-game .game-note:has-text("Registrazione: 0 s")', { timeout: 3000 });
  check('beta: perdita di focus fa ripartire il conteggio da 0 s', true);

  // tocco manuale su "Fine registrazione": il tempo si ferma lì
  await page.waitForTimeout(1200);
  await page.click('#b-game button:has-text("Fine registrazione")');
  await page.waitForSelector('#b-result:not([hidden])', { timeout: 15000 });
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  check('beta: risposta al server = {fatto:true} (il video NON ci passa)', JSON.stringify(bc.body.p_answer), JSON.stringify({ fatto: true }));
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  check('beta: video mostrato (solo in pagina, non salvato)', (await page.locator('#b-video video').count()) === 1);
  const bvSrc = await page.locator('#b-video video').getAttribute('src');
  check('beta: video con data URL video/', bvSrc.startsWith('data:video/'));
  check('beta: save_exercise_video MAI chiamata in beta', log.filter((x) => x.fn === 'save_exercise_video').length === 0);
  await shot(page, '107_esercizi_beta_fatto');
  await page.click('#b-back');

  // ===== 2. Fotocamera negata (contesto a parte: permesso finto negato) =====
  const { ctx: ctx2, page: page2 } = await openApp(browser, A, 'gianmarco@x.it');
  await ctx2.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('negato', 'NotAllowedError'));
  });
  await page2.goto('http://localhost:8765/beta.html');
  await page2.waitForSelector('#b-list:not([hidden])');
  await page2.click('button[data-code="esercizi"]');
  await page2.waitForSelector('#b-play:not([hidden]) .game-start');
  await page2.click('#b-game .game-start');
  await page2.waitForSelector('#b-game[data-phase="errore-camera"]');
  check('negata: messaggio di errore', (await txt(page2, '#b-game')).toLowerCase().includes('fotocamera'));
  check('negata: pulsante Riprova', await visible(page2, '#b-game .game-start'));
  await ctx2.close();

  // ===== 3. Sfida vera =====
  await db.query("update public.challenge_types set enabled = (code = 'esercizi'), game_live = (code = 'esercizi')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  T.fakeNow = '2026-09-21 07:00:00+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('lun: challenge Esercizi', (await txt(page, '#o-ch-name')) === 'Esercizi');
  check('lun: niente Fatto', !(await visible(page, '#b-done')));
  const esercizioVero = log.filter((x) => x.fn === 'get_today').pop().r.io.challenge.parametri.esercizio;
  const titoloVero = EXERCISE_NAMES[esercizioVero].replace(/^./, (c) => c.toUpperCase());
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="gioca"] video', { timeout: 15000 });
  check('lun: titolo con il nome dell\'esercizio anche nella sfida vera', await txt(page, '#o-game .game-title'), titoloVero);
  await shot(page, '108_esercizi_oggi_gioca');
  await page.waitForTimeout(1500);
  await page.click('#o-game button:has-text("Fine registrazione")');
  await page.waitForSelector('#o-result:not([hidden])', { timeout: 15000 });
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok con {fatto:true} (il video NON ci passa)', cg.r.ok === true && JSON.stringify(cg.body.p_answer) === JSON.stringify({ fatto: true }), cg.body);
  const sv = log.filter((x) => x.fn === 'save_exercise_video').pop();
  check('lun: save_exercise_video chiamata con un video', sv && typeof sv.body.p_video === 'string' && sv.body.p_video.startsWith('data:video/'), sv);
  check('lun: save_exercise_video ok', sv && sv.r.ok === true);
  await page.waitForTimeout(300);
  check('lun: pulsante "Guarda video" (non ancora scaricato)', (await txt(page, '#o-video-esercizi button')) === 'Guarda video');
  await page.click('#o-video-esercizi button');
  await page.waitForSelector('#o-video-esercizi video');
  check('lun: video proprio mostrato in "Oggi" dopo il tocco', (await page.locator('#o-video-esercizi video').count()) === 1);
  check('lun: controlli nativi (schermo intero via icona nativa)', await page.getAttribute('#o-video-esercizi video', 'controls') !== null);
  check('lun: video del partner non ancora mostrato (giornata non chiusa)', !(await visible(page, '#o-p-video-esercizi')));
  await shot(page, '109_esercizi_oggi_fatto');

  // ===== 4. B finisce a sua volta: entrambi i video visibili, su entrambi i dispositivi =====
  const { page: pageB, errors: errorsB } = await openApp(browser, B, 'giulia@x.it');
  T.fakeNow = '2026-09-21 07:30:00+02';
  await pageB.goto('http://localhost:8765/');
  await pageB.waitForSelector('#v-main:not([hidden])');
  await pageB.waitForTimeout(500);
  await pageB.click('#o-game .game-start');
  await pageB.waitForSelector('#o-game[data-phase="gioca"] video', { timeout: 15000 });
  await pageB.waitForTimeout(1000);
  await pageB.click('#o-game button:has-text("Fine registrazione")');
  await pageB.waitForSelector('#o-result:not([hidden])', { timeout: 15000 });
  await pageB.waitForTimeout(300);
  await pageB.click('#o-video-esercizi button');
  await pageB.waitForSelector('#o-video-esercizi video');
  check('mar B: video proprio di B (dopo il tocco)', (await pageB.locator('#o-video-esercizi video').count()) === 1);
  check('mar B: giornata chiusa -> pulsante del partner disponibile subito', (await txt(pageB, '#o-p-video-esercizi button')) === 'Guarda video');
  await pageB.click('#o-p-video-esercizi button');
  await pageB.waitForSelector('#o-p-video-esercizi video');
  check('mar B: vede subito anche il video di A', (await pageB.locator('#o-p-video-esercizi video').count()) === 1);
  await shot(pageB, '110_esercizi_oggi_B_fatto');

  await reload(page);   // A ricarica: ora la giornata è chiusa anche per lui
  await page.click('#o-p-video-esercizi button');
  await page.waitForSelector('#o-p-video-esercizi video');
  check('lun A: ora vede anche il video di B', (await page.locator('#o-p-video-esercizi video').count()) === 1);
  await page.click('#o-video-esercizi button');
  await page.waitForSelector('#o-video-esercizi video');
  check('lun A: il proprio resta visibile (dopo il tocco)', (await page.locator('#o-video-esercizi video').count()) === 1);
  await shot(page, '111_esercizi_oggi_entrambi_i_video');

  // ===== 5. Dal Passo 4: NON resta più visibile il giorno dopo (come Occhi
  // aperti, sparisce col cambio di giornata di gioco: niente più 48h) =====
  T.fakeNow = '2026-09-22 07:00:05+02';
  await reload(page);
  check('mar: il video di lunedì non è più "oggi" (proprio)', !(await visible(page, '#o-video-esercizi')));
  check('mar: il video di lunedì non è più "oggi" (partner)', !(await visible(page, '#o-p-video-esercizi')));
  await shot(page, '112_esercizi_oggi_sparito_il_giorno_dopo');

  check('nessun errore in console (A)', errors.length === 0, errors);
  check('nessun errore in console (B)', errorsB.length === 0, errorsB);
  await finish(browser, 'UI passo 3.12');
})().catch(async (e) => { console.error(e); process.exit(2); });
