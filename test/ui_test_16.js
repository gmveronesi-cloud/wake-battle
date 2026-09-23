// Test UI passo 3.9: Caccia ai colori (beta + fotocamera negata + sfida vera).
// Fotocamera finta (vedi ui_lib.js): test/fixtures/caccia.y4m, un quadrato a
// tinta unita che cicla rosso/verde/blu/giallo (2,5 s ciascuno, in loop): la
// sequenza di 5 colori è generata dal server (casuale, vedi wb_gp_caccia_colori
// in sql/16), quindi qualunque colore venga richiesto prima o poi compare
// nel video e resta abbastanza a lungo da soddisfare il mantenimento di
// 1,5 s (countColorPixels()/CACCIA_MIN_PIXELS/CACCIA_HOLD_MS in games.js).
// A differenza di "Accendi la luce" il video è IN DIRETTA (serve mirare
// l'oggetto), come "QR o codice a barre", ma qui la barra resta (showBar di
// default: c'è un livello progressivo verso la soglia/il mantenimento).
const { T, check, db, rpc, log, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

const attr = (page, sel, a) => page.getAttribute(sel, a);

(async () => {
  const browser = await start({ camera: 'caccia.y4m' });
  const { A, B } = await setupCouple();
  T.fakeNow = '2026-09-20 10:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');

  // ===== 1. Beta =====
  await page.goto('http://localhost:8765/beta.html');
  await page.waitForSelector('#b-list:not([hidden])');
  check('beta: Caccia ai colori giocabile', await visible(page, 'button[data-code="caccia_colori"]'));
  await page.click('button[data-code="caccia_colori"]');
  await page.waitForSelector('#b-play:not([hidden]) .game-start');
  const intro = await txt(page, '#b-game');
  check('beta: spiegazione fotocamera/colori', intro.toLowerCase().includes('fotocamera') && intro.toLowerCase().includes('colori'), intro);
  check('beta: niente video/barra prima di Inizia', (await page.locator('#b-game video, #b-game .cam-bar').count()) === 0);
  await shot(page, '80_caccia_beta_intro');
  const t0 = Date.now();
  await page.click('#b-game .game-start');
  await page.waitForSelector('#b-game[data-phase="gioca"] video', { timeout: 15000 });
  check('beta: video in diretta visibile (serve per mirare)', await page.locator('#b-game video').isVisible());
  check('beta: barra presente (progresso verso la soglia)', (await page.locator('#b-game .cam-bar').count()) === 1);
  await page.waitForSelector('#b-game .game-note:has-text("Trova qualcosa")', { timeout: 5000 });
  check('beta: richiesto un primo colore', /Trova qualcosa (ROSSO|VERDE|BLU|GIALLO)/.test(await txt(page, '#b-game .game-note')));
  await shot(page, '81_caccia_beta_gioca');
  await page.waitForSelector('#b-result:not([hidden])', { timeout: 90000 });
  check('beta: non istantaneo (5 colori da trovare)', Date.now() - t0 >= 3000, Date.now() - t0);
  const bc = log.filter((x) => x.fn === 'beta_check').pop();
  check('beta: risposta = {fatto:true}', JSON.stringify(bc.body.p_answer), JSON.stringify({ fatto: true }));
  check('beta: verificata dal server', bc.r.corretto === true);
  check('beta: esito completato', (await txt(page, '#b-result-main')).startsWith('Completato in'));
  await shot(page, '82_caccia_beta_fatto');
  await page.click('#b-back');

  // ===== 2. Fotocamera negata (contesto a parte: permesso finto negato) =====
  const { ctx: ctx2, page: page2 } = await openApp(browser, A, 'gianmarco@x.it');
  await ctx2.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('negato', 'NotAllowedError'));
  });
  await page2.goto('http://localhost:8765/beta.html');
  await page2.waitForSelector('#b-list:not([hidden])');
  await page2.click('button[data-code="caccia_colori"]');
  await page2.waitForSelector('#b-play:not([hidden]) .game-start');
  await page2.click('#b-game .game-start');
  await page2.waitForSelector('#b-game[data-phase="errore-camera"]');
  check('negata: messaggio di errore', (await txt(page2, '#b-game')).toLowerCase().includes('fotocamera'));
  check('negata: pulsante Riprova', await visible(page2, '#b-game .game-start'));
  await shot(page2, '83_caccia_beta_negata');
  await page2.click('#b-game .game-start');
  await page2.waitForTimeout(300);
  check('negata: ancora in errore dopo Riprova (permesso sempre negato)',
    (await attr(page2, '#b-game', 'data-phase')) === 'errore-camera');
  await ctx2.close();

  // ===== 3. Sfida vera =====
  await db.query("update public.challenge_types set enabled = (code = 'caccia_colori'), game_live = (code = 'caccia_colori')");
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  T.fakeNow = '2026-09-21 07:00:00+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('lun: challenge Caccia ai colori', (await txt(page, '#o-ch-name')) === 'Caccia ai colori');
  check('lun: niente Fatto', !(await visible(page, '#b-done')));
  await shot(page, '84_caccia_oggi_intro');
  await page.click('#o-game .game-start');
  await page.waitForSelector('#o-game[data-phase="gioca"] video', { timeout: 15000 });
  await shot(page, '85_caccia_oggi_gioca');
  // cambio scheda a metà partita: non deve far ripartire il gioco
  await tabTo(page, 'sfida'); await tabTo(page, 'oggi');
  check('lun: cambio scheda non ricomincia', (await attr(page, '#o-game', 'data-phase')) !== 'intro');
  await page.waitForSelector('#o-result:not([hidden])', { timeout: 90000 });
  const cg = log.filter((x) => x.fn === 'complete_game').pop();
  check('lun: complete_game ok con {fatto:true}', cg.r.ok === true && cg.body.p_answer.fatto === true, cg.r);
  await shot(page, '86_caccia_oggi_fatto');

  check('nessun errore in console', errors.length === 0, errors);
  await finish(browser, 'UI passo 3.9');
})().catch(async (e) => { console.error(e); process.exit(2); });
