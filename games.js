'use strict';
// Wake Battle — giochi (v4). Usato sia dall'app (sfida vera) sia da beta.html (prova).
// Ogni gioco riceve i parametri generati dal server e, a fine partita, chiama
// onDone(risposta): la risposta viene poi controllata dal server.
// API: WBGames.has(codice) · WBGames.mount(codice, contenitore, parametri, { onDone })
//      → { destroy(), retry() }

(function () {
  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  // ---------------------------------------------------------------------
  // MEMORIA (v4): 5 round di fila. In ogni round 3 simboli visibili 3 s,
  // poi vanno toccati nello stesso ordine. Round riuscito → il successivo
  // parte da solo. Tocco sbagliato → si riparte dal round 1 con simboli nuovi.
  // Le sequenze del server si usano in ordine: ogni round (anche sbagliato)
  // consuma la successiva. Risposta: { inizio, sequenze, tentativi }.
  // Parametri vecchi (senza "round", 6 simboli): un solo round, risposta
  // { tentativo, sequenza } come nel passo 3.1.
  // ---------------------------------------------------------------------
  const SYM = ['🍎', '🐶', '⭐', '🚗', '🌙', '🎈', '🔑', '🐟', '🌵'];

  function memoria(box, params, opts) {
    const seqs = params.sequenze || [];
    const legacy = !params.round;
    const rounds = legacy ? 1 : Number(params.round);
    const showMs = Number(params.mostra_ms) || 3000;
    const len = seqs.length ? seqs[0].length : 3;
    let next = 0;       // prossima sequenza da usare
    let start = 0;      // prima sequenza della partita in corso
    let round = 0;      // round in corso (0-based)
    let tries = 0;      // partite iniziate (1 = nessun errore)
    let done = [];      // sequenze completate nella partita in corso
    let timers = [];
    let dead = false;

    const later = (fn, ms) => { const t = setTimeout(() => { if (!dead) fn(); }, ms); timers.push(t); };
    const clear = () => { timers.forEach(clearTimeout); timers = []; };

    function intro() {
      box.replaceChildren();
      box.dataset.phase = 'intro';
      const text = legacy
        ? 'Memorizza i ' + len + ' simboli: restano visibili ' + Math.round(showMs / 1000) + ' secondi. Poi toccali nello stesso ordine.'
        : rounds + ' round: in ognuno memorizza ' + len + ' simboli (restano visibili ' + Math.round(showMs / 1000) +
          ' secondi), poi toccali nello stesso ordine. Un errore fa ripartire dal round 1.';
      box.appendChild(el('p', text, 'hint'));
      const b = el('button', 'Inizia', 'game-start');
      b.type = 'button';
      b.addEventListener('click', newGame);
      box.appendChild(b);
    }

    // pallini dei round: pieni = fatti, bordato = in corso
    function dots() {
      const d = el('div', null, 'mem-dots');
      for (let i = 0; i < rounds; i++) {
        d.appendChild(el('span', null, i < round ? 'done' : i === round ? 'now' : ''));
      }
      return d;
    }
    function header(text, cls) {
      if (!legacy) box.appendChild(dots());
      box.appendChild(el('p', text, cls || 'game-note'));
    }

    // nuova partita dal round 1, con la prossima sequenza libera
    function newGame() {
      tries++;
      start = next;
      round = 0;
      done = [];
      look();
    }

    // fase 1: guarda
    function look() {
      clear();
      if (next >= seqs.length) {
        box.replaceChildren(el('p', 'Sequenze finite.', 'game-note bad'));
        box.dataset.phase = 'finite';
        return;
      }
      const seq = seqs[next++];
      box.replaceChildren();
      box.dataset.phase = 'guarda';
      box.dataset.round = String(round + 1);
      box.dataset.tentativo = String(tries);
      header(legacy ? (tries === 1 ? 'Memorizza!' : 'Nuova sequenza (tentativo ' + tries + ')')
        : 'Round ' + (round + 1) + ' di ' + rounds + ' · memorizza!');
      const row = el('div', null, 'mem-row n' + seq.length);
      seq.forEach((s) => {
        const c = el('div', SYM[s], 'mem-card');
        c.dataset.s = String(s);
        row.appendChild(c);
      });
      box.appendChild(row);
      const bar = el('div', null, 'bar game-bar');
      const fill = el('div');
      bar.appendChild(fill);
      box.appendChild(bar);
      fill.style.width = '100%';
      fill.style.transition = 'width ' + showMs + 'ms linear';
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = '0%'; }));
      later(() => answer(seq), showMs);
    }

    // fase 2: ripeti
    function answer(seq) {
      box.replaceChildren();
      box.dataset.phase = 'ripeti';
      header(legacy ? 'Tocca i simboli nello stesso ordine' : 'Round ' + (round + 1) + ' di ' + rounds + ' · tocca in ordine');
      const note = box.querySelector('.game-note');
      const slots = el('div', null, 'mem-row n' + seq.length);
      const slotEls = seq.map(() => { const s = el('div', '', 'mem-card mem-slot'); slots.appendChild(s); return s; });
      box.appendChild(slots);
      const keys = el('div', null, 'mem-keys');
      const keyEls = SYM.map((sym, i) => {
        const b = el('button', sym, 'mem-key');
        b.type = 'button';
        b.dataset.s = String(i);
        keys.appendChild(b);
        return b;
      });
      box.appendChild(keys);

      const picked = [];
      const lock = () => keyEls.forEach((b) => { b.disabled = true; });
      keyEls.forEach((b, i) => b.addEventListener('click', () => {
        if (b.disabled) return;
        if (i === seq[picked.length]) {
          picked.push(i);
          const slot = slotEls[picked.length - 1];
          slot.textContent = SYM[i];
          slot.classList.add('ok');
          b.disabled = true;
          if (picked.length === seq.length) {
            lock();
            done.push(picked.slice());
            round++;
            if (round < rounds) {
              note.textContent = '✓ Round ' + round + ' fatto!';
              note.className = 'game-note good';
              box.dataset.phase = 'ok';
              later(look, 700);
            } else {
              note.textContent = 'Controllo…';
              note.className = 'game-note';
              box.dataset.phase = 'fine';
              opts.onDone(legacy
                ? { tentativo: start, sequenza: done[0] }
                : { inizio: start, sequenze: done.slice(), tentativi: tries });
            }
          }
        } else {
          lock();
          b.classList.add('wrong');
          note.textContent = legacy ? 'Sbagliato! Nuova sequenza…' : 'Sbagliato! Si riparte dal round 1…';
          note.className = 'game-note bad';
          box.dataset.phase = 'errore';
          later(newGame, 900);
        }
      }));
    }

    intro();
    return {
      destroy() { dead = true; clear(); box.replaceChildren(); delete box.dataset.phase; },
      // il server ha rifiutato la risposta: nuova partita con sequenze nuove
      retry() { if (!dead) { clear(); newGame(); } },
    };
  }

  const GAMES = { memoria };

  window.WBGames = {
    has: (code) => Object.prototype.hasOwnProperty.call(GAMES, code),
    mount(code, box, params, opts) {
      return GAMES[code](box, params || {}, opts || { onDone() {} });
    },
  };
})();
