'use strict';
// Wake Battle — pagina di prova dei giochi (v6). Non salva tempi né punti.

(function () {
  const cfg = window.WB_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const $ = (id) => document.getElementById(id);

  let current = null;   // { codice, nome, parametri }
  let game = null;
  let t0 = 0;
  let tickTimer = null;

  function msg(text, ok) {
    const e = $('msg');
    if (!text) { e.hidden = true; e.textContent = ''; return; }
    e.textContent = text;
    e.className = ok ? 'msg ok' : 'msg';
    e.hidden = false;
  }
  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function dur(sec) {
    const t = Math.round(Number(sec) * 10) / 10;
    const m = Math.floor(t / 60);
    return m + ':' + (t - m * 60).toFixed(1).padStart(4, '0');
  }
  async function call(fn, args) {
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) { msg('Errore di connessione con il server. Riprova.'); return null; }
    return data;
  }
  function stopGame() {
    clearInterval(tickTimer); tickTimer = null;
    if (game) { game.destroy(); game = null; }
  }

  async function showList() {
    stopGame();
    $('b-play').hidden = true;
    const r = await call('beta_list');
    if (!r || !r.ok) return;
    const ul = $('b-games');
    ul.replaceChildren();
    r.giochi.forEach((g) => {
      const li = el('li');
      const name = el('span', g.nome, 'game-name');
      li.appendChild(name);
      const playable = g.pronto && window.WBGames.has(g.codice);
      if (g.in_sfida) li.appendChild(el('span', 'attivo nella sfida', 'tag on'));
      if (playable) {
        const b = el('button', 'Prova', 'secondary small-btn');
        b.type = 'button';
        b.dataset.code = g.codice;
        b.addEventListener('click', () => play(g.codice));
        li.appendChild(b);
      } else {
        li.appendChild(el('span', 'in arrivo', 'tag'));
        li.classList.add('muted');
      }
      ul.appendChild(li);
    });
    $('b-list').hidden = false;
  }

  async function play(code) {
    msg('');
    stopGame();
    const r = await call('beta_start', { p_code: code });
    if (!r) return;
    if (!r.ok) { msg('Questo gioco non è ancora pronto.'); return; }
    current = { codice: r.codice, nome: r.nome, parametri: r.parametri };
    $('b-list').hidden = true;
    $('b-play').hidden = false;
    $('b-result').hidden = true;
    $('b-game').hidden = false;
    $('b-name').textContent = r.nome;
    t0 = Date.now();
    const tick = () => { $('b-timer').textContent = dur((Date.now() - t0) / 1000); };
    tick();
    tickTimer = setInterval(tick, 100);
    game = window.WBGames.mount(code, $('b-game'), r.parametri, { onDone: finish });
  }

  async function finish(answer) {
    clearInterval(tickTimer); tickTimer = null;
    const secs = (Date.now() - t0) / 1000;
    $('b-timer').textContent = dur(secs);
    const r = await call('beta_check', { p_code: current.codice, p_params: current.parametri, p_answer: answer });
    if (!r) return;
    $('b-result').hidden = false;
    $('b-game').hidden = true;
    if (r.corretto) {
      $('b-result-main').textContent = 'Completato in ' + dur(secs);
      $('b-result-main').className = 'result win';
      const tries = answer && (answer.tentativi || (answer.tentativo != null ? answer.tentativo + 1 : 0));
      $('b-result-sub').textContent = 'Risposta verificata dal server ✓' + (tries > 1 ? ' · tentativi: ' + tries : '') +
        (answer && answer.errori ? ' · errori: ' + answer.errori : '');
    } else {
      $('b-result-main').textContent = 'Risposta non accettata';
      $('b-result-main').className = 'result lose';
      $('b-result-sub').textContent = 'Il server non ha riconosciuto la risposta.';
    }
  }

  $('b-again').addEventListener('click', () => play(current.codice));
  $('b-back').addEventListener('click', () => { msg(''); showList(); });

  (async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { $('b-login').hidden = false; return; }
    await showList();
  })().catch(() => msg('Errore di avvio. Ricarica la pagina.'));
})();
