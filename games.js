'use strict';
// Wake Battle — giochi (v3). Usato sia dall'app (sfida vera) sia da beta.html (prova).
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
  // MEMORIA: 6 simboli visibili per 5 s, poi toccarli nello stesso ordine.
  // Errore al primo tocco sbagliato → nuova sequenza (tentativo successivo).
  // ---------------------------------------------------------------------
  const SYM = ['🍎', '🐶', '⭐', '🚗', '🌙', '🎈', '🔑', '🐟', '🌵'];

  function memoria(box, params, opts) {
    const seqs = params.sequenze || [];
    const showMs = Number(params.mostra_ms) || 5000;
    let k = 0;
    let timers = [];
    let dead = false;

    const later = (fn, ms) => { const t = setTimeout(() => { if (!dead) fn(); }, ms); timers.push(t); };
    const clear = () => { timers.forEach(clearTimeout); timers = []; };

    function intro() {
      box.replaceChildren();
      box.appendChild(el('p', 'Memorizza i 6 simboli: restano visibili 5 secondi. Poi toccali nello stesso ordine.', 'hint'));
      const b = el('button', 'Inizia', 'game-start');
      b.type = 'button';
      b.addEventListener('click', () => look(k));
      box.appendChild(b);
    }

    // fase 1: guarda
    function look(i) {
      clear();
      if (i >= seqs.length) {
        box.replaceChildren(el('p', 'Sequenze finite.', 'game-note bad'));
        return;
      }
      k = i;
      const seq = seqs[k];
      box.replaceChildren();
      box.dataset.phase = 'guarda';
      box.dataset.tentativo = String(k + 1);
      box.appendChild(el('p', k === 0 ? 'Memorizza!' : 'Nuova sequenza (tentativo ' + (k + 1) + ')', 'game-note'));
      const row = el('div', null, 'mem-row');
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
      const note = el('p', 'Tocca i simboli nello stesso ordine', 'game-note');
      box.appendChild(note);
      const slots = el('div', null, 'mem-row');
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
            note.textContent = 'Controllo…';
            note.className = 'game-note';
            box.dataset.phase = 'fine';
            opts.onDone({ tentativo: k, sequenza: picked.slice() });
          }
        } else {
          lock();
          b.classList.add('wrong');
          note.textContent = 'Sbagliato! Nuova sequenza…';
          note.className = 'game-note bad';
          later(() => look(k + 1), 900);
        }
      }));
    }

    intro();
    return {
      destroy() { dead = true; clear(); box.replaceChildren(); delete box.dataset.phase; },
      retry() { if (!dead) look(k + 1); },
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
