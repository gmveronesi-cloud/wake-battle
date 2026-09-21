'use strict';
// Wake Battle — Passo 1b: accesso con email + codice, collegamento coppia.
// Regola di sicurezza: i testi degli utenti vanno SEMPRE in textContent, mai in innerHTML.

(function () {
  const cfg = window.WB_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const $ = (id) => document.getElementById(id);
  const VIEWS = ['v-email', 'v-otp', 'v-name', 'v-pair', 'v-done'];

  let pendingEmail = '';
  let pollTimer = null;
  let countdownTimer = null;
  let codeExpiresAt = null;

  // ---------- UI helpers ----------
  function show(viewId) {
    VIEWS.forEach((v) => { $(v).hidden = v !== viewId; });
    $('foot').hidden = viewId === 'v-email' || viewId === 'v-otp';
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

  function authErrorText(err) {
    const m = (err && err.message ? err.message : '').toLowerCase();
    if (err && err.status === 429 || m.includes('rate limit') || m.includes('security purposes'))
      return 'Troppe richieste: aspetta un minuto e riprova.';
    if (m.includes('expired') || m.includes('invalid') || m.includes('otp'))
      return 'Codice errato o scaduto. Riprova o fatti mandare un nuovo codice.';
    if (m.includes('email')) return 'Email non valida.';
    return 'Qualcosa non ha funzionato. Controlla la connessione e riprova.';
  }

  const JOIN_ERRORS = {
    troppi_tentativi: 'Troppi tentativi. Riprova tra 15 minuti.',
    codice_non_valido: 'Codice non valido o scaduto. Chiedi al partner di crearne uno nuovo.',
    codice_proprio: 'Questo è il tuo codice: deve inserirlo il tuo partner.',
    gia_in_coppia: 'Sei già in coppia.',
  };

  // ---------- Stato ----------
  async function refresh() {
    stopTimers();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { show('v-email'); return; }

    const uid = session.user.id;
    $('who').textContent = session.user.email || '';

    const { data: me, error: e1 } = await sb.from('profiles').select('display_name').eq('id', uid).maybeSingle();
    if (e1) { msg('Errore nel caricare il profilo.'); return; }
    if (!me || !me.display_name) { show('v-name'); return; }

    const { data: members, error: e2 } = await sb.from('couple_members').select('user_id');
    if (e2) { msg('Errore nel caricare la coppia.'); return; }

    if (members && members.length === 2) {
      const partnerId = members.find((m) => m.user_id !== uid).user_id;
      const { data: p } = await sb.from('profiles').select('display_name').eq('id', partnerId).maybeSingle();
      $('me-name').textContent = me.display_name;
      $('partner-name').textContent = (p && p.display_name) || 'Partner';
      show('v-done');
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
      if (error) { msg(authErrorText(error)); return; }
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
      if (error) { msg(authErrorText(error)); return; }
      await refresh();
    });
  });
  $('b-resend').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    const { error } = await sb.auth.signInWithOtp({ email: pendingEmail, options: { shouldCreateUser: true } });
    msg(error ? authErrorText(error) : 'Nuovo codice inviato.', !error);
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

  // ---------- 5. In coppia ----------
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
    await sb.auth.signOut();
    msg('');
    show('v-email');
  });

  // Quando l'app torna in primo piano, riallinea lo stato
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && $('pair-wait').hidden) refresh();
  });

  refresh().catch(() => msg('Errore di avvio. Ricarica la pagina.'));
})();
