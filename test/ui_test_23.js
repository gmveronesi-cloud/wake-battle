// Test UI Passo 4, rifinitura 4/4: comandi iOS + collegamenti dall'app.
// Copre solo la parte verificabile senza un iPhone vero (niente Comandi):
// - "Sono sveglio, spegni le sveglie": pulsante prima della challenge,
//   sparisce al tocco (ricordato per quel giorno) e riappare il giorno dopo;
// - "Aggiorna sveglie": promemoria in "Oggi" dopo un cambio di orario,
//   subito se il cambio vale da oggi, altrimenti solo dopo che la propria
//   giornata si chiude; sparisce quando l'app riceve la conferma da
//   Comandi (link ?sveglie=&giorni=, salvata in localStorage);
// - il link "shortcuts://" non genera errori in console (non possiamo
//   verificare che apra davvero Comandi: serve un iPhone vero, vedi
//   riepilogo per Gianmarco).
const { T, check, rpc, openApp, txt, visible, reload, tabTo, setupCouple, start, finish } = require('./ui_lib');

(async () => {
  const browser = await start();
  const { A, B } = await setupCouple();
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });

  T.fakeNow = '2026-09-20 10:00:00+02';   // domenica: nessuna sveglia impostata per A
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(400);

  // --- primo giro: il cambio vale "da subito" (nessuna sveglia oggi comunque) ---
  await page.click('#b-go-profile'); await page.waitForTimeout(400);
  await page.fill('#alarm-time', '07:00');
  await page.click('#f-alarm button[type="submit"]'); await page.waitForTimeout(500);
  await tabTo(page, 'oggi');
  check('dom: avviso "sveglie non aggiornate" subito (nessuna sveglia oggi in sospeso)', await visible(page, '#o-alarm-warn'));
  check('dom: pulsante "Aggiorna sveglie" nell\'avviso', (await txt(page, '#b-aggiorna-sveglie')) === 'Aggiorna sveglie');
  await page.click('#b-aggiorna-sveglie');
  await page.waitForTimeout(200);

  // --- l'app torna dal comando con ?sveglie=&giorni= : la conferma pulisce l'avviso ---
  await page.goto('http://localhost:8765/?sveglie=07:00&giorni=12345');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(400);
  check('il link di ritorno viene ripulito dall\'URL', !page.url().includes('sveglie='));
  check('dopo la conferma: avviso sparito', !(await visible(page, '#o-alarm-warn')));
  await tabTo(page, 'oggi');
  check('dopo la conferma (tab Oggi): avviso resta sparito', !(await visible(page, '#o-alarm-warn')));

  // --- secondo giro: cambio con MENO di 30 minuti di preavviso mentre oggi
  // ha già una sveglia in sospeso -> l'avviso NON compare finché non si chiude
  T.fakeNow = '2026-09-21 06:50:00+02';   // lunedì, 10 minuti prima delle 07:00
  await reload(page);
  check('lun 06:50: in attesa della sveglia', (await txt(page, '#o-status')).includes('Suona tra'));
  await tabTo(page, 'profilo');
  await page.fill('#alarm-time', '07:15');
  await page.click('#f-alarm button[type="submit"]'); await page.waitForTimeout(500);
  check('cambio a meno di 30 minuti: vale da domani', (await txt(page, '#msg')).includes('domani'));
  await tabTo(page, 'oggi');
  check('lun 06:50: avviso NON mostrato (oggi ha ancora una sveglia in sospeso)', !(await visible(page, '#o-alarm-warn')));

  // la giornata di oggi si chiude (Fatto semplice, nessun gioco attivato in questo test)
  T.fakeNow = '2026-09-21 07:00:05+02';
  await reload(page);
  await page.click('#b-done');
  await page.waitForSelector('#o-result:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(300);
  check('lun, dopo Fatto: ora l\'avviso compare (giornata chiusa)', await visible(page, '#o-alarm-warn'));

  // --- "Sono sveglio": visibile durante la sfida, sparisce al tocco, ricordato per il giorno ---
  // (il cambio di lunedì a 07:15 vale "da subito" per martedì: è il domani
  // di quando è stato fatto, e più di 30 minuti nel futuro valgono sempre
  // "aggiornato", a differenza di "oggi" quando mancano meno di 30 minuti)
  T.fakeNow = '2026-09-22 07:15:05+02';   // martedì: nuova sveglia (07:15) in corso
  await reload(page);
  check('mar: pulsante "Sono sveglio" visibile prima della challenge', await visible(page, '#b-sveglio'));
  await page.click('#b-sveglio');
  check('mar: sparisce al tocco', !(await visible(page, '#b-sveglio')));
  await reload(page);
  check('mar, dopo ricarica: resta nascosto (ricordato per il giorno)', !(await visible(page, '#b-sveglio')));

  T.fakeNow = '2026-09-23 07:15:05+02';   // mercoledì: nuovo giorno, il pulsante torna
  await reload(page);
  check('mer: "Sono sveglio" torna a comparire (nuovo giorno)', await visible(page, '#b-sveglio'));

  check('nessun errore in console (A)', errors.length === 0, errors);
  await finish(browser, 'Passo 4 — comandi iOS');
})().catch(async (e) => { console.error(e); process.exit(2); });
