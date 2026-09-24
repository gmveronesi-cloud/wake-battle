'use strict';
// Wake Battle v23 — Passo 1 (accesso + coppia) + Passo 2 (sveglie, punteggi) + Passo 3 (giochi veri: Memoria, Numeri in ordine, Colore della parola, Riflessi, Anagramma, Accendi la luce, QR o codice a barre, Caccia ai colori, Trova l'oggetto, Occhi aperti, Esercizi).
// Regola di sicurezza: i testi degli utenti vanno SEMPRE in textContent, mai in innerHTML.
// Tempi e punti li decide il server: l'app mostra solo quello che il server risponde.

(function () {
  const cfg = window.WB_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const $ = (id) => document.getElementById(id);
  const VIEWS = ['v-email', 'v-otp', 'v-name', 'v-pair', 'v-main'];
  const TZ = 'Europe/Rome';
  const LIMIT_S = 300;

  let pendingEmail = '';
  let pollTimer = null;
  let countdownTimer = null;
  let codeExpiresAt = null;

  // stato app principale
  let me = { id: null, name: '', email: '' };
  let partnerName = 'Partner';
  let tab = 'oggi';
  let today = null;          // ultima risposta get_today
  let srvOffset = 0;         // ora server - ora telefono (ms)
  let tickTimer = null;      // aggiorna cronometro/countdown
  let todayPoll = null;      // ricarica periodica di Oggi
  let loadingToday = false;
  let selectedDays = new Set();
  let game = null;           // gioco montato in Oggi
  let gameKey = null;        // giorno + codice del gioco montato

  // ---------- UI helpers ----------
  function show(viewId) {
    VIEWS.forEach((v) => { $(v).hidden = v !== viewId; });
    $('foot').hidden = viewId === 'v-email' || viewId === 'v-otp';
    if (viewId !== 'v-main') { stopMainTimers(); stopGame(); }
  }
  function msg(text, ok) {
    const el = $('msg');
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = text;
    el.className = ok ? 'msg ok' : 'msg';
    el.hidden = false;
  }
  async function busy(button, fn) {
    button.disabled = true;
    try { await fn(); } finally { button.disabled = false; }
  }
  function stopTimers() {
    clearInterval(pollTimer); pollTimer = null;
    clearInterval(countdownTimer); countdownTimer = null;
  }
  function stopMainTimers() {
    clearInterval(tickTimer); tickTimer = null;
    clearInterval(todayPoll); todayPoll = null;
  }
  function stopGame() {
    if (game) { game.destroy(); game = null; }
    gameKey = null;
    $('o-game').hidden = true;
  }
  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  // ---------- Formattazione ----------
  const fmtHM = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const fmtYMD = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const WD = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  const MON = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const EXERCISES = {
    piegamenti_10: '10 piegamenti', squat_20: '20 squat', affondi_20: '20 affondi', plank_30: 'Plank 30 secondi',
  };

  const nowSrv = () => Date.now() + srvOffset;
  const hm = (iso) => (iso ? fmtHM.format(new Date(iso)) : '—');
  const todayYMD = () => fmtYMD.format(new Date(nowSrv()));
  function ymdParts(ymd) { const [y, m, d] = ymd.split('-').map(Number); return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; }
  function dayLabel(ymd) { const p = ymdParts(ymd); return WD[p.wd].charAt(0).toUpperCase() + WD[p.wd].slice(1) + ' ' + p.d; }
  function weekLabel(ymd) {
    const p = ymdParts(ymd);
    const end = new Date(Date.UTC(p.y, p.m - 1, p.d + 4));
    return p.d + '–' + end.getUTCDate() + ' ' + MON[end.getUTCMonth()];
  }
  function dur(sec) {
    if (sec == null) return '—';
    const t = Math.round(Number(sec) * 10) / 10;
    const m = Math.floor(t / 60);
    const s = (t - m * 60).toFixed(1).padStart(4, '0');
    return m + ':' + s;
  }
  function pts(n) { return n == null ? '' : String(n).replace('.', ','); }
  function untilText(ms) {
    const min = Math.max(0, Math.ceil(ms / 60000));
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60), r = min % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  }
  function daysText(days) {
    if (!days || !days.length) return 'nessun giorno';
    if (days.length === 5) return 'lun–ven';
    return days.map((d) => WD[d]).join(', ');
  }

  // stage: 'send' (invio codice) oppure 'verify' (controllo codice)
  function authErrorText(err, stage) {
    const raw = err && err.message ? err.message : '';
    const m = raw.toLowerCase();
    const code = (err && err.code ? String(err.code) : '').toLowerCase();
    let text;
    if ((err && err.status === 429) || m.includes('rate limit') || m.includes('security purposes'))
      text = 'Troppe richieste: aspetta un minuto e riprova.';
    else if (m.includes('sending') || m.includes('smtp') || code.includes('email_send'))
      text = 'Il server non è riuscito a spedire l\'email (impostazioni SMTP).';
    else if (stage === 'verify' && (m.includes('expired') || m.includes('invalid') || code.includes('otp')))
      text = 'Codice errato o scaduto. Riprova o fatti mandare un nuovo codice.';
    else if (stage === 'send' && (m.includes('invalid') || code.includes('email_address')))
      text = 'Indirizzo email non accettato.';
    else if (m.includes('failed to fetch') || m.includes('network'))
      text = 'Nessuna connessione con il server. Riprova.';
    else
      text = 'Qualcosa non ha funzionato.';
    return raw ? text + ' [' + raw + ']' : text;
  }

  const JOIN_ERRORS = {
    troppi_tentativi: 'Troppi tentativi. Riprova tra 15 minuti.',
    codice_non_valido: 'Codice non valido o scaduto. Chiedi al partner di crearne uno nuovo.',
    codice_proprio: 'Questo è il tuo codice: deve inserirlo il tuo partner.',
    gia_in_coppia: 'Sei già in coppia.',
  };

  const DONE_ERRORS = {
    troppo_presto: 'La sveglia non è ancora suonata.',
    tempo_scaduto: 'Tempo scaduto: sono passati più di 5 minuti.',
    gia_fatto: 'Hai già completato la challenge di oggi.',
    nessuna_sveglia: 'Oggi non hai la sveglia.',
    serve_il_gioco: 'Questa challenge si completa con il gioco: ricarica la pagina per aggiornare l\'app.',
    nessun_gioco: 'Oggi basta il pulsante Fatto.',
    risposta_sbagliata: 'Risposta non accettata dal server: si riparte con simboli nuovi.',
  };

  // chiama una funzione del server; restituisce data oppure null (con messaggio)
  async function call(fn, args) {
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) { msg('Errore di connessione con il server. Riprova.'); return null; }
    return data;
  }

  // ---------- Stato ----------
  async function refresh() {
    stopTimers();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { show('v-email'); return; }

    const uid = session.user.id;
    $('who').textContent = session.user.email || '';

    const { data: prof, error: e1 } = await sb.from('profiles').select('display_name').eq('id', uid).maybeSingle();
    if (e1) { msg('Errore nel caricare il profilo.'); return; }
    if (!prof || !prof.display_name) { show('v-name'); return; }

    const { data: members, error: e2 } = await sb.from('couple_members').select('user_id');
    if (e2) { msg('Errore nel caricare la coppia.'); return; }

    if (members && members.length === 2) {
      const partnerId = members.find((m) => m.user_id !== uid).user_id;
      const { data: p } = await sb.from('profiles').select('display_name').eq('id', partnerId).maybeSingle();
      me = { id: uid, name: prof.display_name, email: session.user.email || '' };
      partnerName = (p && p.display_name) || 'Partner';
      showMain();
      return;
    }

    showPairChoose();
  }

  function showPairChoose() {
    $('pair-choose').hidden = false;
    $('pair-wait').hidden = true;
    $('pair-expired').hidden = true;
    show('v-pair');
  }

  // ---------- 1. Email ----------
  $('f-email').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const email = $('email').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg('Scrivi un indirizzo email valido.'); return; }
    busy(ev.submitter || $('f-email').querySelector('button'), async () => {
      msg('');
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) { msg(authErrorText(error, 'send')); return; }
      pendingEmail = email;
      $('otp-email').textContent = email;
      $('otp').value = '';
      show('v-otp');
      $('otp').focus();
    });
  });

  // ---------- 2. Codice ----------
  $('otp').addEventListener('input', () => {
    $('otp').value = $('otp').value.replace(/\D/g, '').slice(0, 6);
  });
  $('f-otp').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const token = $('otp').value.trim();
    if (!/^\d{6}$/.test(token)) { msg('Il codice ha 6 cifre.'); return; }
    busy($('f-otp').querySelector('button'), async () => {
      msg('');
      const { error } = await sb.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
      if (error) { msg(authErrorText(error, 'verify')); return; }
      await refresh();
    });
  });
  $('b-resend').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    const { error } = await sb.auth.signInWithOtp({ email: pendingEmail, options: { shouldCreateUser: true } });
    msg(error ? authErrorText(error, 'send') : 'Nuovo codice inviato.', !error);
  }));
  $('b-change-email').addEventListener('click', () => { msg(''); show('v-email'); });

  // ---------- 3. Nome ----------
  $('f-name').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('name').value.replace(/\s+/g, ' ').trim();
    if (name.length < 1 || name.length > 30) { msg('Il nome deve avere da 1 a 30 caratteri.'); return; }
    busy($('f-name').querySelector('button'), async () => {
      const { data: { session } } = await sb.auth.getSession();
      const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', session.user.id);
      if (error) { msg('Non sono riuscito a salvare il nome.'); return; }
      msg('');
      await refresh();
    });
  });

  // ---------- 4. Coppia ----------
  async function createCode(button) {
    await busy(button, async () => {
      msg('');
      const { data, error } = await sb.rpc('create_pairing_code');
      if (error) {
        if ((error.message || '').includes('già in coppia')) { await refresh(); return; }
        msg('Non sono riuscito a creare il codice. Riprova.');
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      $('pair-code').textContent = row.code;
      codeExpiresAt = new Date(row.expires_at).getTime();
      $('pair-choose').hidden = true;
      $('pair-expired').hidden = true;
      $('pair-wait').hidden = false;
      startWaiting();
    });
  }

  function startWaiting() {
    stopTimers();
    const tick = () => {
      const left = Math.max(0, Math.round((codeExpiresAt - Date.now()) / 1000));
      $('pair-left').textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      if (left === 0) {
        stopTimers();
        $('pair-wait').hidden = true;
        $('pair-expired').hidden = false;
      }
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
    pollTimer = setInterval(async () => {
      const { data } = await sb.from('couple_members').select('user_id');
      if (data && data.length === 2) { msg('Collegati!', true); await refresh(); }
    }, 3000);
  }

  $('b-create').addEventListener('click', (ev) => createCode(ev.currentTarget));
  $('b-regen').addEventListener('click', (ev) => createCode(ev.currentTarget));
  $('b-cancel-code').addEventListener('click', () => { stopTimers(); showPairChoose(); });

  $('join-code').addEventListener('input', () => {
    $('join-code').value = $('join-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });
  $('f-join').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const code = $('join-code').value;
    if (code.length !== 6) { msg('Il codice ha 6 caratteri.'); return; }
    busy($('f-join').querySelector('button'), async () => {
      msg('');
      const { data, error } = await sb.rpc('join_couple', { p_code: code });
      if (error) { msg('Errore di connessione. Riprova.'); return; }
      if (!data || !data.ok) { msg(JOIN_ERRORS[data && data.error] || 'Codice non valido.'); return; }
      $('join-code').value = '';
      msg('Collegati!', true);
      await refresh();
    });
  });

  // =====================================================================
  // 5. APP PRINCIPALE
  // =====================================================================
  function showMain() {
    $('me-name').textContent = me.name;
    $('partner-name').textContent = partnerName;
    show('v-main');
    setTab(tab);
  }

  function setTab(name) {
    tab = name;
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    ['oggi', 'sfida', 'profilo'].forEach((t) => { $('t-' + t).hidden = t !== name; });
    stopMainTimers();
    if (name === 'oggi') {
      loadToday();
      todayPoll = setInterval(() => { if (document.visibilityState === 'visible') loadToday(); }, 20000);
      tickTimer = setInterval(tick, 100);
    } else if (name === 'sfida') {
      loadWeek();
    } else {
      loadSettings();
    }
  }
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { msg(''); setTab(b.dataset.tab); }));
  $('b-go-profile').addEventListener('click', () => setTab('profilo'));

  // ---------- OGGI ----------
  async function loadToday() {
    if (loadingToday) return;
    loadingToday = true;
    try {
      const t0 = Date.now();
      const data = await call('get_today');
      const t1 = Date.now();
      if (!data) return;
      if (!data.ok) {
        if (data.error === 'senza_partner' || data.error === 'senza_coppia') { await refresh(); }
        return;
      }
      srvOffset = new Date(data.ora_server).getTime() - (t0 + t1) / 2;
      today = data;
      renderToday();
      // la prima volta controlla se la sveglia è impostata
      if (!data.io.sveglia && $('o-setup').dataset.checked !== '1') checkSetup();
    } finally {
      loadingToday = false;
    }
  }

  async function checkSetup() {
    const s = await call('get_settings');
    $('o-setup').dataset.checked = '1';
    $('o-setup').hidden = !(s && s.ok && !s.io);
  }

  // codice del gioco vero da giocare oggi (null = pulsante Fatto)
  function gameCode(ch) {
    const g = ch && ch.parametri && ch.parametri.gioco;
    return g && window.WBGames && window.WBGames.has(g) ? g : null;
  }

  // "Trova l'oggetto": tocco su una miniatura -> apre la stessa foto a
  // schermo intero in #foto-lightbox; tocco sulla foto ingrandita per
  // richiuderla.
  function openLightbox(src) {
    $('foto-lightbox-img').src = src;
    $('foto-lightbox').hidden = false;
  }
  $('foto-lightbox').addEventListener('click', () => { $('foto-lightbox').hidden = true; });

  // Le miniature scattate durante la partita, proprie e del partner
  // (get_today le manda già filtrate per visibilità/24 ore).
  function renderFoto(id, foto) {
    const box = $(id);
    box.replaceChildren();
    box.hidden = !(foto && foto.length);
    (foto || []).forEach((src) => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.addEventListener('click', () => openLightbox(src));
      box.appendChild(img);
    });
  }

  // "Occhi aperti"/"Esercizi": il video registrato durante la partita,
  // proprio o del partner (get_today lo manda già filtrato per visibilità:
  // 24 ore su "oggi" per 'video', 48 ore piene per 'video_esercizi', come
  // 'foto'). A differenza delle foto, "schermo intero" si ottiene con i
  // controlli nativi del <video> (icona di ingrandimento): nessuna
  // lightbox dedicata.
  function renderVideo(id, src) {
    const box = $(id);
    box.replaceChildren();
    box.hidden = !src;
    if (!src) return;
    const video = document.createElement('video');
    video.src = src;
    video.controls = true;
    video.playsInline = true;
    box.appendChild(video);
  }

  function renderToday() {
    const t = today;
    const io = t.io, pa = t.partner;

    $('o-alarm').textContent = hm(io.sveglia);
    $('o-play').hidden = io.stato !== 'in_corso';
    $('o-result').hidden = !(io.stato === 'fatto' || io.stato === 'scaduto');
    $('b-done').disabled = false;

    const statusText = {
      nessuna_sveglia: 'Nessuna sveglia oggi.',
      in_attesa: '',
      in_corso: '',
      fatto: '',
      scaduto: '',
    };
    $('o-status').textContent = statusText[io.stato] || '';

    const code = io.stato === 'in_corso' ? gameCode(io.challenge) : null;
    if (io.stato === 'in_corso' && io.challenge) {
      $('o-ch-name').textContent = io.challenge.nome;
      if (code) {
        $('o-ch-detail').textContent = 'Il cronometro è partito all\'orario della sveglia: «Inizia» non lo ferma.';
      } else {
        const ex = io.challenge.parametri && EXERCISES[io.challenge.parametri.esercizio];
        $('o-ch-detail').textContent = (ex ? ex + '. ' : '') + 'Per ora basta premere Fatto: questo gioco arriva più avanti.';
      }
    }
    $('b-done').hidden = !!code;
    if (code) {
      const key = t.giorno + ':' + code;
      if (gameKey !== key) {
        stopGame();
        gameKey = key;
        $('o-game').hidden = false;
        game = window.WBGames.mount(code, $('o-game'), io.challenge.parametri, { onDone: finishGame });
      }
    } else if (game) {
      stopGame();
    }

    if (io.stato === 'fatto') {
      $('o-result-main').textContent = 'Fatto in ' + dur(io.secondi);
      $('o-result-main').className = 'result win';
    } else if (io.stato === 'scaduto') {
      $('o-result-main').textContent = 'Tempo scaduto';
      $('o-result-main').className = 'result lose';
    }
    $('o-result-ch').textContent = io.challenge ? 'Challenge: ' + io.challenge.nome : '';
    renderFoto('o-foto', io.foto);
    renderVideo('o-video', io.video);
    renderVideo('o-video-esercizi', io.video_esercizi);

    // partner
    $('o-p-label').textContent = pa.nome || partnerName;
    $('o-p-alarm').textContent = hm(pa.sveglia);
    $('o-p-status').textContent = {
      nessuna_sveglia: 'Niente sveglia oggi.',
      nascosto: pa.sveglia ? 'Il risultato si vede a fine giornata.' : '',
      fatto: 'Fatto in ' + dur(pa.secondi),
      scaduto: 'Tempo scaduto',
    }[pa.stato] || '';
    renderFoto('o-p-foto', pa.foto);
    renderVideo('o-p-video', pa.video);
    renderVideo('o-p-video-esercizi', pa.video_esercizi);

    // esito della giornata
    const b = $('o-day');
    b.className = 'banner';
    const wd = ymdParts(t.giorno).wd;
    if (!t.conta) {
      if (wd === 0 || wd === 6) b.textContent = 'Weekend: niente sfida.';
      else if (!io.sveglia && !pa.sveglia) b.textContent = 'Oggi niente sfida.';
      else b.textContent = 'Oggi non conta: serve la sveglia di entrambi.';
      b.hidden = false;
    } else if (t.chiuso) {
      const a = Number(io.punti), c = Number(pa.punti);
      if (a === 1) { b.textContent = 'Giornata vinta! +1'; b.className = 'banner win'; }
      else if (a === 0.5) b.textContent = 'Pareggio: mezzo punto a testa.';
      else if (c === 1) { b.textContent = 'Giornata a ' + (pa.nome || partnerName) + '.'; b.className = 'banner lose'; }
      else b.textContent = 'Nessun punto oggi.';
      b.hidden = false;
    } else {
      b.hidden = true;
    }
    tick();
  }

  // aggiornamento ogni 100 ms: cronometro, barra, countdown
  function tick() {
    const t = today;
    if (!t || tab !== 'oggi') return;
    const io = t.io;
    const now = nowSrv();
    if (io.stato === 'in_attesa') {
      const alarm = new Date(io.sveglia).getTime();
      if (now >= alarm) { io.stato = '…'; loadToday(); return; }
      $('o-status').textContent = 'Suona tra ' + untilText(alarm - now) + '. La challenge si scopre all\'orario della sveglia.';
    } else if (io.stato === 'in_corso') {
      const elapsed = Math.max(0, now - new Date(io.sveglia).getTime()) / 1000;
      $('o-timer').textContent = dur(Math.floor(elapsed * 10) / 10);
      $('o-bar').style.width = Math.min(100, (elapsed / LIMIT_S) * 100) + '%';
      const left = Math.max(0, LIMIT_S - elapsed);
      $('o-left').textContent = 'Restano ' + Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0');
      if (elapsed > LIMIT_S + 1) { io.stato = '…'; loadToday(); }
    }
  }

  // registra il risultato (Fatto semplice o gioco); true = registrato
  async function sendDone(fn, args) {
    msg('');
    const r = await call(fn, args);
    if (!r) return false;
    if (!r.ok) {
      msg(DONE_ERRORS[r.error] || 'Non registrato. Riprova.');
      if (r.error === 'risposta_sbagliata' && game) game.retry();
      else await loadToday();
      return false;
    }
    msg('Registrato: ' + dur(r.secondi), true);
    await loadToday();
    return true;
  }

  $('b-done').addEventListener('click', (ev) => busy(ev.currentTarget, () => sendDone('complete_challenge')));

  // "Trova l'oggetto" aggiunge alla risposta un array "foto" (le miniature
  // scattate ad ogni tocco), "Occhi aperti"/"Esercizi" una stringa "video"
  // (il video registrato): vanno staccati dalla risposta del gioco vero e
  // proprio (supererebbero il limite di byte di complete_game) e salvati a
  // parte, solo se il "Fatto" è stato registrato — con save_object_photos()
  // per le foto, save_eye_video() per Occhi aperti, save_exercise_video()
  // per Esercizi (stessa forma della risposta {fatto:true, video}, tabelle
  // e regole di visibilità diverse: si distingue dal codice del gioco
  // montato, ricavato da gameKey).
  async function finishGame(answer) {
    const code = gameKey ? gameKey.split(':')[1] : null;
    let foto = null;
    let video = null;
    let videoEsercizi = null;
    if (answer && Array.isArray(answer.foto)) {
      foto = answer.foto;
      answer = Object.assign({}, answer);
      delete answer.foto;
    }
    if (answer && typeof answer.video === 'string') {
      answer = Object.assign({}, answer);
      if (code === 'esercizi') videoEsercizi = answer.video;
      else video = answer.video;
      delete answer.video;
    }
    const ok = await sendDone('complete_game', { p_answer: answer });
    if (ok && (foto || video || videoEsercizi)) {
      if (foto) await call('save_object_photos', { p_foto: foto });
      if (video) await call('save_eye_video', { p_video: video });
      if (videoEsercizi) await call('save_exercise_video', { p_video: videoEsercizi });
      await loadToday();   // rifà il giro: la prima loadToday() (dentro sendDone) non aveva ancora foto/video
    }
    return ok;
  }

  // ---------- SFIDA ----------
  async function loadWeek() {
    const [w, h] = await Promise.all([call('get_week'), call('get_history')]);
    if (w && w.ok) renderWeek(w);
    if (h && h.ok) renderHistory(h);
  }

  function renderWeek(w) {
    srvOffset = new Date(w.ora_server).getTime() - Date.now();
    $('s-week-label').textContent = 'Settimana ' + weekLabel(w.settimana);
    $('s-me-name').textContent = me.name;
    $('s-pa-name').textContent = partnerName;
    $('s-th-pa').textContent = partnerName;
    $('s-me-pts').textContent = pts(w.totale.io.punti);
    $('s-pa-pts').textContent = pts(w.totale.partner.punti);
    $('s-me-time').textContent = w.giornate_valide ? 'tempo ' + dur(w.totale.io.secondi) : '';
    $('s-pa-time').textContent = w.giornate_valide ? 'tempo ' + dur(w.totale.partner.secondi) : '';

    const v = $('s-verdict');
    v.className = 'banner';
    if (!w.verdetto_pronto) v.textContent = 'Verdetto sabato alle 12:00.';
    else if (w.vincitore === 'io') { v.textContent = 'Hai vinto la settimana!'; v.className = 'banner win'; }
    else if (w.vincitore === 'partner') { v.textContent = 'Settimana vinta da ' + partnerName + '.'; v.className = 'banner lose'; }
    else if (w.vincitore === 'pareggio') v.textContent = 'Settimana in perfetto pareggio.';
    else v.textContent = 'Nessuna giornata valida questa settimana.';

    const body = $('s-days');
    body.replaceChildren();
    const todayStr = todayYMD();
    w.giorni.forEach((d) => {
      const tr = document.createElement('tr');
      tr.appendChild(el('td', dayLabel(d.giorno)));
      let chText, meText = '', paText = '', meWin = false, paWin = false, muted = false;
      if (d.chiuso && d.conta) {
        chText = d.challenge || '—';
        meText = dur(d.io.secondi);
        paText = dur(d.partner.secondi);
        if (d.io.secondi == null) meText = 'scaduto';
        if (d.partner.secondi == null) paText = 'scaduto';
        meWin = Number(d.io.punti) === 1; paWin = Number(d.partner.punti) === 1;
      } else if (d.giorno < todayStr || (d.chiuso && !d.conta)) {
        chText = 'non conta'; muted = true;
      } else if (d.giorno === todayStr) {
        chText = d.conta ? 'in corso' : 'non conta'; muted = true;
      } else {
        chText = '—'; muted = true;
      }
      tr.appendChild(el('td', chText, muted ? 'muted' : ''));
      tr.appendChild(el('td', meText, meWin ? 'win' : ''));
      tr.appendChild(el('td', paText, paWin ? 'win' : ''));
      body.appendChild(tr);
    });

    // premio
    const pm = w.premio_modificabile;
    const next = pm.settimana !== w.settimana;
    $('s-prize-label').textContent = next ? 'Premio della prossima settimana' : 'Premio della settimana';
    const shown = next ? pm.testo : (w.premio || pm.testo);
    $('s-prize-current').textContent = shown || 'Nessun premio impostato.';
    $('prize').value = pm.testo || '';
  }

  function renderHistory(h) {
    $('h-wins').textContent = me.name + ' ' + h.vittorie.io + ' · ' + partnerName + ' ' + h.vittorie.partner +
      (h.vittorie.pareggi ? ' · pareggi ' + h.vittorie.pareggi : '');
    const ul = $('h-list');
    ul.replaceChildren();
    if (!h.settimane.length) { ul.appendChild(el('li', 'Ancora nessuna settimana conclusa.', 'small')); return; }
    h.settimane.forEach((s) => {
      const res = s.vincitore === 'io' ? 'vinta da ' + me.name
        : s.vincitore === 'partner' ? 'vinta da ' + partnerName : 'pareggio';
      const li = el('li');
      li.appendChild(el('strong', 'Settimana ' + weekLabel(s.settimana) + ': '));
      li.appendChild(document.createTextNode(res + ' (' + pts(s.totale.io.punti) + '–' + pts(s.totale.partner.punti) + ')'));
      if (s.premio) { li.appendChild(el('br')); li.appendChild(el('span', 'Premio: ' + s.premio, 'small')); }
      ul.appendChild(li);
    });
  }

  $('f-prize').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = $('prize').value.replace(/\s+/g, ' ').trim();
    if (text.length > 200) { msg('Massimo 200 caratteri.'); return; }
    busy($('f-prize').querySelector('button'), async () => {
      const r = await call('set_prize', { p_text: text });
      if (!r) return;
      if (!r.ok) { msg('Premio troppo lungo (max 200 caratteri).'); return; }
      msg(text ? 'Premio salvato.' : 'Premio cancellato.', true);
      await loadWeek();
    });
  });

  // ---------- PROFILO ----------
  function renderDays() {
    document.querySelectorAll('.day').forEach((b) => b.setAttribute('aria-pressed', String(selectedDays.has(Number(b.dataset.day)))));
  }
  document.querySelectorAll('.day').forEach((b) => b.addEventListener('click', () => {
    const d = Number(b.dataset.day);
    if (selectedDays.has(d)) selectedDays.delete(d); else selectedDays.add(d);
    renderDays();
  }));

  async function loadSettings() {
    $('p-account').textContent = me.name + ' · ' + me.email;
    const s = await call('get_settings');
    if (!s || !s.ok) return;
    if (s.io) {
      $('alarm-time').value = s.io.orario;
      selectedDays = new Set(s.io.giorni);
    } else {
      if (!$('alarm-time').value) $('alarm-time').value = '07:00';
      selectedDays = new Set([1, 2, 3, 4, 5]);
    }
    renderDays();
    $('p-effective').textContent = 'Oggi: ' + (s.io_oggi ? hm(s.io_oggi) : 'nessuna') +
      ' · Domani: ' + (s.io_domani ? hm(s.io_domani) : 'nessuna');
    const pa = s.partner || {};
    $('p-partner-label').textContent = 'Sveglia di ' + (pa.nome || partnerName);
    $('p-partner').textContent = pa.orario
      ? pa.orario + ' (' + daysText(pa.giorni) + ') · oggi ' + (pa.oggi ? hm(pa.oggi) : 'nessuna') + ', domani ' + (pa.domani ? hm(pa.domani) : 'nessuna')
      : 'Non l\'ha ancora impostata.';
  }

  $('f-alarm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const time = $('alarm-time').value;
    if (!/^\d{2}:\d{2}/.test(time)) { msg('Scegli un orario.'); return; }
    busy($('f-alarm').querySelector('button[type="submit"]'), async () => {
      const r = await call('set_alarm', { p_time: time.slice(0, 5), p_days: Array.from(selectedDays).sort() });
      if (!r) return;
      if (!r.ok) {
        msg({ giorni_non_validi: 'Giorni non validi: solo da lunedì a venerdì.', senza_coppia: 'Prima collegati al partner.' }[r.error] || 'Non salvato. Riprova.');
        return;
      }
      let text = 'Sveglia salvata.';
      if (r.oggi.stato === 'invariato') {
        text += ' Per oggi resta ' + (r.oggi.sveglia ? 'alle ' + hm(r.oggi.sveglia) : 'senza sveglia') +
          ': il nuovo orario è a meno di 30 minuti da adesso. Vale da domani.';
      } else if (r.oggi.stato === 'bloccato') {
        text += ' La sveglia di oggi è già suonata: il cambio vale da domani.';
      }
      if (r.domani.stato === 'invariato') {
        text += ' Anche domani resta ' + (r.domani.sveglia ? 'alle ' + hm(r.domani.sveglia) : 'senza sveglia') + ' (meno di 30 minuti).';
      }
      msg(text, true);
      $('o-setup').hidden = true;
      await loadSettings();
    });
  });

  $('b-leave').addEventListener('click', (ev) => {
    if (!confirm('Vuoi davvero scollegare la coppia?')) return;
    busy(ev.currentTarget, async () => {
      const { error } = await sb.rpc('leave_couple');
      if (error) { msg('Non sono riuscito a scollegare. Riprova.'); return; }
      msg('');
      await refresh();
    });
  });

  // ---------- Uscita ----------
  $('b-logout').addEventListener('click', async () => {
    stopTimers();
    stopMainTimers();
    stopGame();
    await sb.auth.signOut();
    msg('');
    show('v-email');
  });

  // Quando l'app torna in primo piano, riallinea lo stato
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!$('v-main').hidden) { setTab(tab); return; }
    if ($('pair-wait').hidden) refresh();
  });

  refresh().catch(() => msg('Errore di avvio. Ricarica la pagina.'));
})();
