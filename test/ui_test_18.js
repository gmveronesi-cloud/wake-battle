// Test UI passo 3.11: Occhi aperti (beta + fotocamera negata + sfida vera).
// Quinto gioco con fotocamera, ma FRONTALE (le altre usano la posteriore) e in
// modalità record:true (games.js): niente analisi dei frame, un solo pulsante
// "Inizia" fa partire la registrazione di un video di 10 secondi che si ferma
// DA SOLA e completa il gioco in automatico, {fatto:true} (il video viaggia a
// parte, save_eye_video, mai in beta). La fotocamera finta basta "camera:true"
// (fixture di default luce.y4m, vedi ui_lib.js): qui non serve nessun
// contenuto particolare nel video, solo che MediaRecorder produca un blob.
// Novità testata anche qui: se il documento perde il focus durante la
// registrazione (visibilitychange -> hidden), quella si scarta e riparte da
// zero in automatico (simulato forzando document.hidden e l'evento).
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, setupCouple, start, finish } = require('./ui_lib');

const attr = (page, sel, a) => page.getAttribute(sel, a);

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
  check('beta: Occhi aperti giocabile', await visible(page, 'button[data-code="occhi"]'));
  await page.click('button[data-code="occhi"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  const intro = await txt(page, '#b-game');
  check('beta: spiegazione fotocamera frontale/10 secondi', intro.toLowerCase().includes('frontale') && intro.includes('10 secondi'));
  check('beta: niente video prima di Inizia', (await page.locator('#b-game video').count()) === 0);
  await shot(page, '96_occhi_beta_intro');
  await page.click('#b-game .game-start');
  await page.waitForSelector('#b-game[data-phase="gioca"] video', { timeout: 15000 });
  check('beta: video in diretta (anteprima mentre si registra)', await page.locator('#b-game video').isVisible());
  check('beta: niente barra (solo il countdown testuale)', (await page.locator('#b-game .cam-bar').count()) === 0);
  await page.waitForSelector('#b-game .game-note:has-text("Registrazione:")', { timeout: 5000 });
  await shot(page, '97_occhi_beta_gioca');

  // perdita di focus a metà registrazione -> si scarta e riparte da zero
  await page.waitForTimeout(3000);
  await hideDoc(page, true);
  await page.waitForTimeout(400);
  const noteAfterReset = await txt(page, '#b-game .game-note');
  check('beta: perdita di focus fa ripartire il countdown da 10 s', /Registrazione: (9|10) s/.test(noteAfterReset), noteAfterReset);
  await hideDoc(page, false);

  // completa la registrazione (10 s dal riavvio)
  await page.waitForSelector('#b-result:not([hidden])', { timeout: 15000 });
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  check('beta: risposta al server = {fatto:true} (il video NON ci passa)', JSON.stringify(bc.body.p_answer), JSON.stringify({ fatto: true }));
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  check('beta: video mostrato (solo in pagina, non salvato)', (await page.locator('#b-video video').count()) === 1);
  const bvSrc = await page.locator('#b-video video').getAttribute('src');
  check('beta: video con data URL video/', bvSrc.startsWith('data:video/'));
  check('beta: save_eye_video MAI chiamata in beta', log.filter((x) => x.fn === 'save_eye_video').length === 0);
  await shot(page, '98_occhi_beta_fatto');
  await page.click('#b-back');

  // ===== 2. Fotocamera negata (contesto a parte: permesso finto negato) =====
  const { ctx: ctx2, page: page2 } = await openApp(browser, A, 'gianmarco@x.it');
  await ctx2.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('negato', 'NotAllowedError'));
  });
  await page2.goto('http://localhost:8765/beta.html');
  await page2.waitForSelector('#b-list:not([hidden])');
  await page2.click('button[data-code="occhi"]');
  await page2.waitForSelector('#b-play:not([hidden]) .game-start');
  await page2.click('#b-game .game-start');
  await page2.waitForSelector('#b-game[data-phase="errore-camera"]');
  check('negata: messaggio di errore', (await txt(page2, '#b-game')).toLowerCase().includes('fotocamera'));
  check('negata: pulsante Riprova', await visible(page2, '#b-game .game-start'));
  await shot(page2, '99_occhi_beta_negata');
  await page2.click('#b-game .game-start');
  await page2.waitForTimeout(300);
  check('negata: ancora in errore dopo Riprova (permesso sempre negato)',
    (await attr(page2, '#b-game', 'data-phase')) === 'errore-camera');
  await ctx2.close();

  // ===== 3. Sfida vera =====
  await db.query("update public.challenge_types set enabled = (code = 'occhi'), game_live = (code = 'occhi')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  T.fakeNow = '2026-09-21 07:00:00+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('lun: challenge Occhi aperti', (await txt(page, '#o-ch-name')) === 'Occhi aperti');
  check('lun: niente Fatto', !(await visible(page, '#b-done')));
  await shot(page, '100_occhi_oggi_intro');
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="gioca"] video', { timeout: 15000 });
  await shot(page, '101_occhi_oggi_gioca');
  await page.waitForSelector('#o-result:not([hidden])', { timeout: 15000 });
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok con {fatto:true} (il video NON ci passa)', cg.r.ok === true && JSON.stringify(cg.body.p_answer) === JSON.stringify({ fatto: true }), cg.body);
  const sv = log.filter((x) => x.fn === 'save_eye_video').pop();
  check('lun: save_eye_video chiamata con un video', sv && typeof sv.body.p_video === 'string' && sv.body.p_video.startsWith('data:video/'), sv);
  check('lun: save_eye_video ok', sv && sv.r.ok === true);
  await page.waitForTimeout(300);
  // v25: get_today() manda solo il flag "ha_video", il contenuto si scarica
  // al tocco di "Guarda video" (get_eye_video)
  check('lun: pulsante "Guarda video" (non ancora scaricato)', (await txt(page, '#o-video button')) === 'Guarda video');
  await page.click('#o-video button');
  await page.waitForSelector('#o-video video');
  check('lun: video proprio mostrato in "Oggi" dopo il tocco', (await page.locator('#o-video video').count()) === 1);
  check('lun: controlli nativi (schermo intero via icona nativa)', await attr(page, '#o-video video', 'controls') !== null);
  check('lun: video del partner non ancora mostrato (giornata non chiusa)', !(await visible(page, '#o-p-video')));
  await shot(page, '102_occhi_oggi_fatto');

  // ===== 4. B finisce a sua volta: entrambi i video visibili, su entrambi i dispositivi =====
  const { page: pageB, errors: errorsB } = await openApp(browser, B, 'giulia@x.it');
  T.fakeNow = '2026-09-21 07:30:00+02';
  await pageB.goto('http://localhost:8765/');
  await pageB.waitForSelector('#v-main:not([hidden])');
  await pageB.waitForTimeout(500);
  await pageB.click('#o-game .game-start');
  await pageB.waitForSelector('#o-game[data-phase="gioca"] video', { timeout: 15000 });
  await pageB.waitForSelector('#o-result:not([hidden])', { timeout: 15000 });
  await pageB.waitForTimeout(300);
  await pageB.click('#o-video button');
  await pageB.waitForSelector('#o-video video');
  check('mar B: video proprio di B (dopo il tocco)', (await pageB.locator('#o-video video').count()) === 1);
  check('mar B: giornata chiusa -> pulsante del partner disponibile subito', (await txt(pageB, '#o-p-video button')) === 'Guarda video');
  await pageB.click('#o-p-video button');
  await pageB.waitForSelector('#o-p-video video');
  check('mar B: vede subito anche il video di A', (await pageB.locator('#o-p-video video').count()) === 1);
  await shot(pageB, '103_occhi_oggi_B_fatto');

  await reload(page);   // A ricarica: ora la giornata è chiusa anche per lui
  await page.click('#o-p-video button');
  await page.waitForSelector('#o-p-video video');
  check('lun A: ora vede anche il video di B', (await page.locator('#o-p-video video').count()) === 1);
  await page.click('#o-video button');
  await page.waitForSelector('#o-video video');
  check('lun A: il proprio resta visibile (dopo il tocco)', (await page.locator('#o-video video').count()) === 1);
  await shot(page, '104_occhi_oggi_entrambi_i_video');

  check('nessun errore in console (A)', errors.length === 0, errors);
  check('nessun errore in console (B)', errorsB.length === 0, errorsB);
  await finish(browser, 'UI passo 3.11');
})().catch(async (e) => { console.error(e); process.exit(2); });
