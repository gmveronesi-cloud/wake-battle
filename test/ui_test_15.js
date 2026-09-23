// Test UI passo 3.8: QR o codice a barre (beta + fotocamera negata + sfida vera).
// Fotocamera finta (vedi ui_lib.js): test/fixtures/qr.y4m, un QR leggibile
// ("https://wakebattle.test/qr", generato con la libreria python "qrcode")
// in loop — basta UNA lettura valida per finire, nessun tempo di
// mantenimento (a differenza di "Accendi la luce"): decodeFrame()/QR_SAMPLE/
// QR_INTERVAL_MS sono in games.js.
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

const attr = (page, sel, a) => page.getAttribute(sel, a);

(async () => {
  const browser = await start({ camera: 'qr.y4m' });
  const { A, B } = await setupCouple();
  T.fakeNow = '2026-09-20 10:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');

  // ===== 1. Beta =====
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: QR o codice a barre giocabile', await visible(page, 'button[data-code="qr"]'));
  await page.click('button[data-code="qr"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  const intro = await txt(page, '#b-game');
  check('beta: spiegazione fotocamera/QR', intro.toLowerCase().includes('qr') || intro.toLowerCase().includes('codice a barre'));
  check('beta: niente video/barra prima di Inizia', (await page.locator('#b-game video, #b-game .cam-bar').count()) === 0);
  await shot(page, '73_qr_beta_intro');
  const t0 = Date.now();
  await page.click('#b-game .game-start');
  await page.waitForSelector('#b-game[data-phase="gioca"] .cam-bar', { timeout: 15000 });
  check('beta: video presente ma nascosto (niente feed live)', await page.locator('#b-game video').isHidden());
  await shot(page, '74_qr_beta_gioca');
  await page.waitForSelector('#b-result:not([hidden])', { timeout: 15000 });
  check('beta: letto in fretta, nessun tempo di mantenimento (non 10 s come luce)', Date.now() - t0 < 8000, Date.now() - t0);
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  check('beta: risposta = {fatto:true}', JSON.stringify(bc.body.p_answer), JSON.stringify({ fatto: true }));
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  await shot(page, '75_qr_beta_fatto');
  await page.click('#b-back');

  // ===== 2. Fotocamera negata (contesto a parte: permesso finto negato) =====
  const { ctx: ctx2, page: page2 } = await openApp(browser, A, 'gianmarco@x.it');
  await ctx2.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('negato', 'NotAllowedError'));
  });
  await page2.goto('http://localhost:8765/beta.html');
  await page2.waitForSelector('#b-list:not([hidden])');
  await page2.click('button[data-code="qr"]');
  await page2.waitForSelector('#b-play:not([hidden]) .game-start');
  await page2.click('#b-game .game-start');
  await page2.waitForSelector('#b-game[data-phase="errore-camera"]');
  check('negata: messaggio di errore', (await txt(page2, '#b-game')).toLowerCase().includes('fotocamera'));
  check('negata: pulsante Riprova', await visible(page2, '#b-game .game-start'));
  await shot(page2, '76_qr_beta_negata');
  await page2.click('#b-game .game-start');
  await page2.waitForTimeout(300);
  check('negata: ancora in errore dopo Riprova (permesso sempre negato)',
    (await attr(page2, '#b-game', 'data-phase')) === 'errore-camera');
  await ctx2.close();

  // ===== 3. Sfida vera =====
  await db.query("update public.challenge_types set enabled = (code = 'qr'), game_live = (code = 'qr')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  T.fakeNow = '2026-09-21 07:00:00+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('lun: challenge QR o codice a barre', (await txt(page, '#o-ch-name')) === 'QR o codice a barre');
  check('lun: niente Fatto', !(await visible(page, '#b-done')));
  await shot(page, '77_qr_oggi_intro');
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="gioca"] .cam-bar', { timeout: 15000 });
  await shot(page, '78_qr_oggi_gioca');
  await page.waitForSelector('#o-result:not([hidden])', { timeout: 15000 });
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok con {fatto:true}', cg.r.ok === true && cg.body.p_answer.fatto === true, cg.r);
  await shot(page, '79_qr_oggi_fatto');

  check('nessun errore in console', errors.length === 0, errors);
  await finish(browser, 'UI passo 3.8');
})().catch(async (e) => { console.error(e); process.exit(2); });
