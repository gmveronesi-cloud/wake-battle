// Test UI passo 2 (regressione): la web app vera nel browser, chiamate a Supabase
// inoltrate al Postgres locale (orologio del server simulato).
const { T, check, db, rpc, openApp, txt, visible, shot, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

(async () => {
  const browser = await start();
  const { A, B } = await setupCouple();
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');

  // --- Domenica: nessuna sveglia -> invito a impostarla
  T.fakeNow = '2026-09-20 10:00:00+02';
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('dom: nomi vs', (await txt(page, '.vs-line')).includes('Gianmarco') && (await txt(page, '.vs-line')).includes('Giulia'));
  check('dom: card imposta sveglia', await visible(page, '#o-setup'));
  check('dom: banner weekend', (await txt(page, '#o-day')).includes('Weekend'));
  await shot(page, '01_domenica_setup');

  // --- Profilo: imposta 07:00 lun–ven
  await page.click('#b-go-profile'); await page.waitForTimeout(400);
  check('profilo: default 5 giorni', (await page.locator('.day[aria-pressed="true"]').count()) === 5);
  await page.fill('#alarm-time', '07:00');
  await page.click('#f-alarm button[type="submit"]'); await page.waitForTimeout(500);
  check('profilo: salvata', (await txt(page, '#msg')).includes('Sveglia salvata'));
  check('profilo: domani 07:00', (await txt(page, '#p-effective')).includes('Domani: 07:00'));
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });
  await tabTo(page, 'profilo');
  check('profilo: vede sveglia partner', (await txt(page, '#p-partner')).includes('07:30 (lun–ven)'));
  await shot(page, '02_profilo');

  // --- Lunedì 06:30: in attesa
  T.fakeNow = '2026-09-21 06:30:00+02';
  await tabTo(page, 'oggi'); await reload(page);
  check('lun 06:30: sveglia 07:00', (await txt(page, '#o-alarm')) === '07:00');
  check('lun 06:30: suona tra 30 min', (await txt(page, '#o-status')).includes('Suona tra 30 min'), await txt(page, '#o-status'));
  check('lun 06:30: niente Fatto', !(await visible(page, '#b-done')));
  check('lun 06:30: sveglia partner 07:30', (await txt(page, '#o-p-alarm')) === '07:30');
  await shot(page, '03_lunedi_attesa');

  // --- Lunedì 07:01:30: in corso -> Fatto
  T.fakeNow = '2026-09-21 07:01:30+02';
  await reload(page);
  check('lun 07:01: pulsante Fatto', await visible(page, '#b-done'));
  const timer = await txt(page, '#o-timer');
  check('lun 07:01: cronometro ~1:30', /^1:3\d\.\d$/.test(timer), timer);
  check('lun 07:01: challenge mostrata', (await txt(page, '#o-ch-name')).length > 2);
  await shot(page, '04_lunedi_in_corso');
  await page.click('#b-done'); await page.waitForTimeout(600);
  check('lun: registrato 1:30.0', (await txt(page, '#msg')).includes('1:30.0'), await txt(page, '#msg'));
  check('lun: risultato Fatto in 1:30.0', (await txt(page, '#o-result-main')) === 'Fatto in 1:30.0');
  check('lun: partner nascosto', (await txt(page, '#o-p-status')).includes('fine giornata'));
  await shot(page, '05_lunedi_fatto');

  // --- B completa alle 07:32 -> giornata chiusa, A vince
  T.fakeNow = '2026-09-21 07:32:00+02';
  await rpc(B, 'complete_challenge', {});
  T.fakeNow = '2026-09-21 07:33:00+02';
  await reload(page);
  check('lun chiuso: tempo partner', (await txt(page, '#o-p-status')) === 'Fatto in 2:00.0');
  check('lun chiuso: vinta', (await txt(page, '#o-day')).includes('Giornata vinta'));
  await shot(page, '06_lunedi_vinta');

  // --- Martedì 06:45: cambio a 07:10 troppo vicino -> resta 07:00, messaggio
  T.fakeNow = '2026-09-22 06:45:00+02';
  await tabTo(page, 'profilo');

  // Scheda "Istruzioni" (Passo 4): sezioni collassate via <details> native
  check('profilo: scheda Istruzioni presente con più sezioni', (await page.locator('.instructions details').count()) >= 5);
  check('profilo: sezioni chiuse di default', await page.locator('.instructions details').first().getAttribute('open') === null);
  await page.click('.instructions summary >> nth=0');
  check('profilo: una sezione si apre al tocco', (await page.locator('.instructions details').first().getAttribute('open')) !== null);

  await page.fill('#alarm-time', '07:10');
  await page.click('#f-alarm button[type="submit"]'); await page.waitForTimeout(500);
  check('mar: regola 30 min spiegata', (await txt(page, '#msg')).includes('meno di 30 minuti'), await txt(page, '#msg'));
  check('mar: oggi resta 07:00', (await txt(page, '#p-effective')).includes('Oggi: 07:00'));
  await shot(page, '07_profilo_30min');
  await page.fill('#alarm-time', '07:00');
  await page.click('#f-alarm button[type="submit"]'); await page.waitForTimeout(400);

  // --- Martedì: A scade, B fa -> Mercoledì/Giovedì via SQL
  T.fakeNow = '2026-09-22 07:32:00+02'; await rpc(B, 'complete_challenge', {});
  T.fakeNow = '2026-09-22 07:40:00+02';
  await tabTo(page, 'oggi'); await reload(page);
  check('mar: scaduto', (await txt(page, '#o-result-main')) === 'Tempo scaduto');
  check('mar: giornata a Giulia', (await txt(page, '#o-day')).includes('Giornata a Giulia'));
  T.fakeNow = '2026-09-23 07:02:00+02'; await rpc(A, 'complete_challenge', {});
  T.fakeNow = '2026-09-23 07:32:00+02'; await rpc(B, 'complete_challenge', {});
  T.fakeNow = '2026-09-24 07:00:45+02'; await rpc(A, 'complete_challenge', {});

  // --- Giovedì 07:10: Sfida a metà settimana + premio
  T.fakeNow = '2026-09-24 07:10:00+02';
  await tabTo(page, 'sfida');
  check('sfida: punti Gianmarco', (await txt(page, '#s-me-pts')) === '1,5', await txt(page, '#s-me-pts'));
  check('sfida: punti Giulia', (await txt(page, '#s-pa-pts')) === '1,5', await txt(page, '#s-pa-pts'));
  check('sfida: verdetto sabato', (await txt(page, '#s-verdict')).includes('sabato alle 12:00'));
  check('sfida: giovedì in corso', (await page.locator('#s-days tr').nth(3).innerText()).includes('in corso'));
  await page.fill('#prize', 'Cena offerta dal perdente');
  await page.click('#f-prize button'); await page.waitForTimeout(500);
  check('sfida: premio salvato', (await txt(page, '#s-prize-current')) === 'Cena offerta dal perdente');
  await shot(page, '08_sfida_meta_settimana');

  // --- Sabato 12:00: verdetto
  T.fakeNow = '2026-09-26 12:00:00+02';
  await tabTo(page, 'oggi'); await tabTo(page, 'sfida');
  const v = await txt(page, '#s-verdict');
  check('sab: verdetto', v.includes('Hai vinto') || v.includes('vinta da') || v.includes('pareggio'), v);
  check('sab: storico 1 settimana', (await page.locator('#h-list li').count()) === 1);
  check('sab: premio prossima settimana', (await txt(page, '#s-prize-label')).includes('prossima'));
  await shot(page, '09_sabato_verdetto');
  await tabTo(page, 'oggi');
  check('sab: niente sfida', (await txt(page, '#o-day')).includes('Weekend'));

  check('nessun errore in console', errors.length === 0, errors);
  await finish(browser, 'UI passo 2');
})().catch(async (e) => { console.error(e); process.exit(2); });
