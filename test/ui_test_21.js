// Test UI Passo 4, rifinitura 2/3: "Salta" (giorno di assenza).
// Pulsante #b-salta in "Oggi": salta la PROSSIMA sveglia di chi lo preme
// (qui: oggi, con ampio preavviso), annullabile con lo stesso pulsante
// ("Annulla salto") finché resta nella finestra dei 30 minuti. Il partner
// non se ne accorge finché la sua giornata non è chiusa: gioca
// normalmente, poi vede "Giornata annullata: <nome> ha saltato." Dopo il
// tocco l'app prova a rilanciare il comando iOS ("WB Salta"/"WB Imposta
// sveglie" per l'annullamento) con un link `shortcuts://`: qui verifichiamo
// solo che il tentativo non generi errori in console (uno schema non
// gestito in Chromium viene ignorato in silenzio, niente da testare oltre).
const { T, check, rpc, log, openApp, txt, visible, reload, setupCouple, start, finish } = require('./ui_lib');

(async () => {
  const browser = await start();
  const { A, B } = await setupCouple();
  await rpc(A, 'set_alarm', { p_time: '07:00', p_days: '{1,2,3,4,5}' });
  await rpc(B, 'set_alarm', { p_time: '07:30', p_days: '{1,2,3,4,5}' });

  // lunedì 06:00: mancano 60 minuti alla sveglia di A -> "Salta" annulla oggi
  T.fakeNow = '2026-09-21 06:00:00+02';
  const { page, errors } = await openApp(browser, A, 'gianmarco@x.it');
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#v-main:not([hidden])');
  await page.waitForTimeout(500);
  check('A: pulsante "Salta" prima di qualunque salto', (await txt(page, '#b-salta')) === 'Salta');

  await page.click('#b-salta');
  await page.waitForTimeout(300);
  const sd = log.filter((x) => x.fn === 'skip_day').pop();
  check('A: skip_day chiamata e accettata', sd && sd.r.ok === true, sd);
  check('A: giorno saltato = oggi (lunedì)', sd && sd.r.giorno === '2026-09-21', sd);
  check('A: messaggio "Hai saltato lun 21."', (await txt(page, '#msg')).includes('Hai saltato'));
  check('A: pulsante diventa "Annulla salto"', (await txt(page, '#b-salta')) === 'Annulla salto');
  check('A: banner "oggi non conta" (salto proprio, nessun segreto)', (await txt(page, '#o-day')).includes('non conta'));
  check('A: niente gioco/Fatto mostrato', !(await visible(page, '#o-play')));

  // ricarica: lo stato del salto persiste (letto da get_today, non solo lato client)
  await reload(page);
  check('A dopo ricarica: resta "Annulla salto"', (await txt(page, '#b-salta')) === 'Annulla salto');
  check('A dopo ricarica: sveglia mostra "Hai saltato oggi."', (await txt(page, '#o-status')).includes('Hai saltato'));

  // ===== B (partner) non si accorge di nulla: gioca normalmente =====
  T.fakeNow = '2026-09-21 07:30:10+02';
  const { page: pageB, errors: errorsB } = await openApp(browser, B, 'giulia@x.it');
  await pageB.goto('http://localhost:8765/');
  await pageB.waitForSelector('#v-main:not([hidden])');
  await pageB.waitForTimeout(500);
  check('B: sveglia normale, in corso', await visible(pageB, '#o-play'));
  check('B: nessun avviso "annullata" prima di finire', !(await txt(pageB, '#o-day')).includes('annullata'));
  await pageB.click('#b-done');
  await pageB.waitForSelector('#o-result:not([hidden])', { timeout: 10000 });
  await pageB.waitForTimeout(300);
  check('B: ora vede "Giornata annullata: Gianmarco ha saltato."', (await txt(pageB, '#o-day')).includes('Giornata annullata') && (await txt(pageB, '#o-day')).includes('Gianmarco'));

  await reload(page);   // A ricarica: vede B fatto, resta lui stesso "saltato"
  check('A: resta saltato dopo che B ha finito', (await txt(page, '#o-status')).includes('Hai saltato'));
  check('A: banner mostra "hai saltato tu"', (await txt(page, '#o-day')).includes('hai saltato tu'));

  // ===== annulla salto su un altro giorno (martedì), ampio preavviso =====
  T.fakeNow = '2026-09-22 06:00:00+02';
  await reload(page);
  check('A martedì: pulsante "Salta" di nuovo (nuovo giorno)', (await txt(page, '#b-salta')) === 'Salta');
  await page.click('#b-salta');
  await page.waitForTimeout(300);
  check('A: salta martedì', (await txt(page, '#b-salta')) === 'Annulla salto');
  await page.click('#b-salta');
  await page.waitForTimeout(300);
  const usd = log.filter((x) => x.fn === 'unskip_day').pop();
  check('A: unskip_day chiamata e accettata', usd && usd.r.ok === true, usd);
  check('A: torna al pulsante "Salta"', (await txt(page, '#b-salta')) === 'Salta');
  check('A: torna alla sveglia normale (in attesa)', !(await txt(page, '#o-status')).includes('Hai saltato'));

  check('nessun errore in console (A)', errors.length === 0, errors);
  check('nessun errore in console (B)', errorsB.length === 0, errorsB);
  await finish(browser, 'Passo 4 — Salta');
})().catch(async (e) => { console.error(e); process.exit(2); });
