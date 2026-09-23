// Test UI passo 3.7: Accendi la luce (beta + fotocamera negata + sfida vera).
// Fotocamera finta (vedi ui_lib.js): video di test buio 2 s poi 12 s con un
// quadrato luminoso concentrato al centro (~14% del frame, resto al buio),
// in loop — verifica che si rilevi un PUNTO di luce e non la media del
// frame (LUCE_PIXEL_SOGLIA/LUCE_MIN_HOT/LUCE_MS_MIN sono in games.js).
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

const attr = (page, sel, a) => page.getAttribute(sel, a);
const barPct = async (page, sel) => {
  const w = await page.locator(`${sel} .cam-bar > div`).evaluate((e) => e.style.width);
  return parseFloat(w) || 0;
};

(async () => {
  const browser = await start({ camera: true });
  const { A, B } = await setupCouple();
  T.fakeNow = '2026-09-20 10:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');

  // ===== 1. Beta =====
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: Accendi la luce giocabile', await visible(page, 'button[data-code="luce"]'));
  await page.click('button[data-code="luce"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  const intro = await txt(page, '#b-game');
  check('beta: spiegazione fotocamera/luce', intro.includes('fotocamera') && intro.toLowerCase().includes('luce'), intro);
  check('beta: niente video/barra prima di Inizia', (await page.locator('#b-game video, #b-game .cam-bar').count()) === 0);
  await shot(page, '66_luce_beta_intro');
  const t0 = Date.now();
  await page.click('#b-game .game-start');
  await page.waitForSelector('#b-game[data-phase="gioca"] .cam-bar', { timeout: 15000 });
  check('beta: video presente ma nascosto (niente feed live)', await page.locator('#b-game video').isHidden());
  const pct1 = await barPct(page, '#b-game');
  check('beta: barra livello presente (0-100)', pct1 >= 0 && pct1 <= 100, pct1);
  await shot(page, '67_luce_beta_gioca');
  // durante il buio iniziale (soglia non raggiunta) niente countdown
  check('beta: niente countdown durante il buio', !(await txt(page, '#b-game .game-note')).includes('tieni ferma'));
  await page.waitForSelector('#b-game .game-note:has-text("tieni ferma")', { timeout: 15000 });
  await shot(page, '671_luce_beta_countdown');
  await page.waitForSelector('#b-result:not([hidden])', { timeout: 20000 });
  check('beta: soglia mantenuta almeno 10 s prima di completare (non istantaneo)', Date.now() - t0 >= 9000, Date.now() - t0);
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  check('beta: risposta = {fatto:true}', JSON.stringify(bc.body.p_answer), JSON.stringify({ fatto: true }));
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  await shot(page, '68_luce_beta_fatto');
  await page.click('#b-back');

  // ===== 2. Fotocamera negata (contesto a parte: permesso finto negato) =====
  const { ctx: ctx2, page: page2 } = await openApp(browser, A, 'gianmarco@x.it');
  await ctx2.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('negato', 'NotAllowedError'));
  });
  await page2.goto('http://localhost:8765/beta.html');
  await page2.waitForSelector('#b-list:not([hidden])');
  await page2.click('button[data-code="luce"]');
  await page2.waitForSelector('#b-play:not([hidden]) .game-start');
  await page2.click('#b-game .game-start');
  await page2.waitForSelector('#b-game[data-phase="errore-camera"]');
  check('negata: messaggio di errore', (await txt(page2, '#b-game')).toLowerCase().includes('fotocamera'));
  check('negata: pulsante Riprova', await visible(page2, '#b-game .game-start'));
  await shot(page2, '69_luce_beta_negata');
  await page2.click('#b-game .game-start');
  await page2.waitForTimeout(300);
  check('negata: ancora in errore dopo Riprova (permesso sempre negato)',
    (await attr(page2, '#b-game', 'data-phase')) === 'errore-camera');
  await ctx2.close();

  // ===== 3. Sfida vera =====
  await db.query("update public.challenge_types set enabled = (code = 'luce'), game_live = (code = 'luce')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  T.fakeNow = '2026-09-21 07:00:00+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('lun: challenge Accendi la luce', (await txt(page, '#o-ch-name')) === 'Accendi la luce');
  check('lun: niente Fatto', !(await visible(page, '#b-done')));
  await shot(page, '70_luce_oggi_intro');
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="gioca"] .cam-bar', { timeout: 15000 });
  await shot(page, '71_luce_oggi_gioca');
  // cambio scheda a metà (buio, non ancora completato): non deve far ripartire il gioco
  await tabTo(page, 'sfida'); await tabTo(page, 'oggi');
  check('lun: cambio scheda non ricomincia', (await attr(page, '#o-game', 'data-phase')) !== 'intro');
  await page.waitForSelector('#o-game .game-note:has-text("tieni ferma")', { timeout: 15000 });
  await page.waitForSelector('#o-result:not([hidden])', { timeout: 20000 });
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok con {fatto:true}', cg.r.ok === true && cg.body.p_answer.fatto === true, cg.r);
  await shot(page, '72_luce_oggi_fatto');

  check('nessun errore in console', errors.length === 0, errors);
  await finish(browser, 'UI passo 3.7');
})().catch(async (e) => { console.error(e); process.exit(2); });
