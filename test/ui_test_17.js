// Test UI passo 3.10: Trova l'oggetto (beta + fotocamera negata + sfida vera).
// Quarto gioco con fotocamera, ma NESSUNA analisi del frame (deciso il
// 23/09/2026: niente IA di riconoscimento): cameraGame({manual:true}) in
// games.js mostra solo il video in diretta (showVideo:true, showBar:false,
// come "QR") e un pulsante "Trovato!" che la persona tocca da sola 5 volte,
// una per ogni oggetto della sequenza del server. Ogni tocco scatta anche
// una miniatura (snapshot() in games.js): la fotocamera finta basta
// "camera:true" (fixture di default luce.y4m, vedi ui_lib.js), qui non
// serve nessun contenuto particolare nel video perché non c'è analisi dei
// pixel. Le foto non passano da beta_check/complete_game (staccate in
// beta.js/app.js, vedi commenti lì): niente salvataggio in beta (mostrate
// solo un attimo in pagina), salvate con save_object_photos() nella sfida
// vera e rese visibili nella galleria #o-foto/#o-p-foto (sql/17).
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

const attr = (page, sel, a) => page.getAttribute(sel, a);

async function tapFound(page, sel, n) {
  for (let i = 0; i < n; i++) {
    await page.click(sel);
    await page.waitForTimeout(150);
  }
}

(async () => {
  const browser = await start({ camera: true });
  const { A, B } = await setupCouple();
  T.fakeNow = '2026-09-20 10:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');

  // ===== 1. Beta =====
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: Trova l\'oggetto giocabile', await visible(page, 'button[data-code="oggetto"]'));
  await page.click('button[data-code="oggetto"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  const intro = await txt(page, '#b-game');
  check('beta: spiegazione fotocamera/Trovato', intro.toLowerCase().includes('fotocamera') && intro.toLowerCase().includes('trovato'));
  check('beta: niente video/pulsante prima di Inizia', (await page.locator('#b-game video, #b-game .cam-bar').count()) === 0);
  await shot(page, '87_oggetto_beta_intro');
  await page.click('#b-game .game-start');
  await page.waitForSelector('#b-game[data-phase="gioca"] video', { timeout: 15000 });
  check('beta: video in diretta visibile (serve per mirare)', await page.locator('#b-game video').isVisible());
  check('beta: niente barra (nessun mantenimento, solo il tocco)', (await page.locator('#b-game .cam-bar').count()) === 0);
  await page.waitForSelector('#b-game .game-note:has-text("Trova:")', { timeout: 5000 });
  check('beta: primo oggetto richiesto (1/5)', /Trova: .+ \(1\/5\)/.test(await txt(page, '#b-game .game-note')));
  check('beta: pulsante "Trovato!"', (await txt(page, '#b-game .game-start')) === 'Trovato!');
  await shot(page, '88_oggetto_beta_gioca');
  await tapFound(page, '#b-game[data-phase="gioca"] .game-start', 1);
  check('beta: dopo un tocco passa al 2° oggetto', /Trova: .+ \(2\/5\)/.test(await txt(page, '#b-game .game-note')));
  await tapFound(page, '#b-game[data-phase="gioca"] .game-start', 4);
  await page.waitForSelector('#b-result:not([hidden])', { timeout: 10000 });
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  check('beta: risposta al server = {fatto:true} (le foto NON ci passano)', JSON.stringify(bc.body.p_answer), JSON.stringify({ fatto: true }));
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  check('beta: 5 miniature mostrate (solo in pagina, non salvate)', (await page.locator('#b-foto img').count()) === 5);
  await shot(page, '89_oggetto_beta_fatto');
  // tocco su una miniatura -> schermo intero, tocco per richiudere
  check('beta: lightbox chiusa prima del tocco', !(await visible(page, '#foto-lightbox')));
  const firstSrc = await page.locator('#b-foto img').first().getAttribute('src');
  await page.locator('#b-foto img').first().click();
  await page.waitForSelector('#foto-lightbox:not([hidden])');
  check('beta: lightbox mostra la stessa foto', (await page.locator('#foto-lightbox-img').getAttribute('src')) === firstSrc);
  await shot(page, '89b_oggetto_beta_lightbox');
  await page.click('#foto-lightbox');
  check('beta: tocco sulla lightbox la richiude', !(await visible(page, '#foto-lightbox')));
  await page.click('#b-back');

  // ===== 2. Fotocamera negata (contesto a parte: permesso finto negato) =====
  const { ctx: ctx2, page: page2 } = await openApp(browser, A, 'gianmarco@x.it');
  await ctx2.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('negato', 'NotAllowedError'));
  });
  await page2.goto('http://localhost:8765/beta.html');
  await page2.waitForSelector('#b-list:not([hidden])');
  await page2.click('button[data-code="oggetto"]');
  await page2.waitForSelector('#b-play:not([hidden]) .game-start');
  await page2.click('#b-game .game-start');
  await page2.waitForSelector('#b-game[data-phase="errore-camera"]');
  check('negata: messaggio di errore', (await txt(page2, '#b-game')).toLowerCase().includes('fotocamera'));
  check('negata: pulsante Riprova', await visible(page2, '#b-game .game-start'));
  await shot(page2, '90_oggetto_beta_negata');
  await page2.click('#b-game .game-start');
  await page2.waitForTimeout(300);
  check('negata: ancora in errore dopo Riprova (permesso sempre negato)',
    (await attr(page2, '#b-game', 'data-phase')) === 'errore-camera');
  await ctx2.close();

  // ===== 3. Sfida vera =====
  await db.query("update public.challenge_types set enabled = (code = 'oggetto'), game_live = (code = 'oggetto')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  T.fakeNow = '2026-09-21 07:00:00+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('lun: challenge Trova l\'oggetto', (await txt(page, '#o-ch-name')) === 'Trova l\'oggetto');
  check('lun: niente Fatto', !(await visible(page, '#b-done')));
  await shot(page, '91_oggetto_oggi_intro');
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="gioca"] video', { timeout: 15000 });
  await shot(page, '92_oggetto_oggi_gioca');
  // cambio scheda a metà partita: non deve far ripartire il gioco
  await tabTo(page, 'sfida'); await tabTo(page, 'oggi');
  check('lun: cambio scheda non ricomincia', (await attr(page, '#o-game', 'data-phase')) !== 'intro');
  await tapFound(page, '#o-game[data-phase="gioca"] .game-start', 5);
  await page.waitForSelector('#o-result:not([hidden])', { timeout: 10000 });
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok con {fatto:true} (le foto NON ci passano)', cg.r.ok === true && JSON.stringify(cg.body.p_answer) === JSON.stringify({ fatto: true }), cg.body);
  const sp = log.filter((x) => x.fn === 'save_object_photos').pop();
  check('lun: save_object_photos chiamata con 5 miniature', sp && sp.body.p_foto.length === 5, sp);
  check('lun: save_object_photos ok', sp && sp.r.ok === true);
  await page.waitForTimeout(300);
  // v25: get_today() manda solo il flag "ha_foto", il contenuto si scarica
  // al tocco di "Vedi foto" (get_object_photos)
  check('lun: pulsante "Vedi foto" (non ancora scaricate)', (await txt(page, '#o-foto button')) === 'Vedi foto');
  await page.click('#o-foto button');
  await page.waitForSelector('#o-foto img');
  check('lun: galleria propria mostrata in "Oggi" dopo il tocco', (await page.locator('#o-foto img').count()) === 5);
  check('lun: foto del partner non ancora mostrate (giornata non chiusa)', !(await visible(page, '#o-p-foto')));
  await shot(page, '93_oggetto_oggi_fatto');

  // ===== 4. B finisce a sua volta: entrambe le gallerie, in sezioni separate, su entrambi i dispositivi =====
  const { page: pageB, errors: errorsB } = await openApp(browser, B, 'giulia@x.it');
  T.fakeNow = '2026-09-21 07:30:00+02';
  await pageB.goto('http://localhost:8765/');
  await pageB.waitForSelector('#v-main:not([hidden])');
  await pageB.waitForTimeout(500);
  await pageB.click('#o-game .game-start');
  await pageB.waitForSelector('#o-game[data-phase="gioca"] video', { timeout: 15000 });
  await tapFound(pageB, '#o-game[data-phase="gioca"] .game-start', 5);
  await pageB.waitForSelector('#o-result:not([hidden])', { timeout: 10000 });
  await pageB.waitForTimeout(300);
  await pageB.click('#o-foto button');
  await pageB.waitForSelector('#o-foto img');
  check('mar B: galleria propria di B (dopo il tocco)', (await pageB.locator('#o-foto img').count()) === 5);
  check('mar B: giornata chiusa -> pulsante "Vedi foto" del partner disponibile subito', (await txt(pageB, '#o-p-foto button')) === 'Vedi foto');
  await pageB.click('#o-p-foto button');
  await pageB.waitForSelector('#o-p-foto img');
  check('mar B: vede subito anche le foto di A', (await pageB.locator('#o-p-foto img').count()) === 5);
  await shot(pageB, '94_oggetto_oggi_B_fatto');

  await reload(page);   // A ricarica: ora la giornata è chiusa anche per lui
  check('lun A: pulsante "Vedi foto" del partner ora disponibile', (await txt(page, '#o-p-foto button')) === 'Vedi foto');
  await page.click('#o-p-foto button');
  await page.waitForSelector('#o-p-foto img');
  check('lun A: ora vede anche le foto di B, in una sezione separata', (await page.locator('#o-p-foto img').count()) === 5);
  await page.click('#o-foto button');
  await page.waitForSelector('#o-foto img');
  check('lun A: le proprie restano visibili nella loro sezione (dopo il tocco)', (await page.locator('#o-foto img').count()) === 5);
  check('lun A: due gallerie distinte (proprie dentro #o-result, del partner fuori, nella sua card)',
    (await page.locator('#o-result #o-foto').count()) === 1 && (await page.locator('#o-result #o-p-foto').count()) === 0);
  const partnerSrc = await page.locator('#o-p-foto img').first().getAttribute('src');
  await page.locator('#o-p-foto img').first().click();
  await page.waitForSelector('#foto-lightbox:not([hidden])');
  check('lun A: lightbox anche sulle foto del partner', (await page.locator('#foto-lightbox-img').getAttribute('src')) === partnerSrc);
  await page.click('#foto-lightbox');
  await shot(page, '95_oggetto_oggi_entrambe_le_gallerie');

  check('nessun errore in console (A)', errors.length === 0, errors);
  check('nessun errore in console (B)', errorsB.length === 0, errorsB);
  await finish(browser, 'UI passo 3.10');
})().catch(async (e) => { console.error(e); process.exit(2); });
