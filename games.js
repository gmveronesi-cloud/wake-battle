'use strict';
// Wake Battle — giochi (v7). Usato sia dall'app (sfida vera) sia da beta.html (prova).
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

  // ---------------------------------------------------------------------
  // NUMERI IN ORDINE (v5): griglia 5×5 con 1..25 in posizioni del server,
  // coperta fino a "Inizia". Tocco giusto → casella grigia; tocco sbagliato
  // → lampeggio rosso, nessuna penalità. Al 25 la risposta parte da sola:
  // { tocchi: [posizione dell'1, del 2, ... del 25], errori }.
  // ---------------------------------------------------------------------
  function numeri(box, params, opts) {
    const disp = params.disposizione || [];
    const side = Number(params.lato) || 5;
    const total = disp.length;
    let timers = [];
    let dead = false;
    const clear = () => { timers.forEach(clearTimeout); timers = []; };

    function intro() {
      box.replaceChildren();
      box.dataset.phase = 'intro';
      box.appendChild(el('p', 'Tocca i numeri da 1 a ' + total + ' in ordine, il più in fretta possibile. ' +
        'Un tocco sbagliato lampeggia di rosso: nessuna penalità, continua.', 'hint'));
      const b = el('button', 'Inizia', 'game-start');
      b.type = 'button';
      b.addEventListener('click', play);
      box.appendChild(b);
    }

    function play() {
      clear();
      let next = 1;
      let errors = 0;
      const taps = [];
      box.replaceChildren();
      box.dataset.phase = 'gioca';
      box.dataset.prossimo = '1';
      const note = el('p', 'Prossimo: 1', 'game-note');
      box.appendChild(note);
      const grid = el('div', null, 'num-grid');
      grid.style.gridTemplateColumns = 'repeat(' + side + ', minmax(0, 1fr))';
      const cells = disp.map((n, pos) => {
        const b = el('button', String(n), 'num-cell');
        b.type = 'button';
        b.dataset.n = String(n);
        b.addEventListener('click', () => {
          if (dead || b.disabled || next > total) return;
          if (n === next) {
            b.disabled = true;
            b.classList.remove('wrong');
            b.classList.add('preso');
            taps.push(pos);
            next++;
            box.dataset.prossimo = String(next);
            if (next > total) {
              cells.forEach((c) => { c.disabled = true; });
              note.textContent = 'Controllo…' + (errors ? ' (errori: ' + errors + ')' : '');
              box.dataset.phase = 'fine';
              opts.onDone({ tocchi: taps.slice(), errori: errors });
            } else {
              note.textContent = 'Prossimo: ' + next;
            }
          } else {
            errors++;
            box.dataset.errori = String(errors);
            b.classList.remove('wrong');
            void b.offsetWidth; // fa ripartire il lampeggio
            b.classList.add('wrong');
            const t = setTimeout(() => b.classList.remove('wrong'), 300);
            timers.push(t);
          }
        });
        grid.appendChild(b);
        return b;
      });
      box.appendChild(grid);
    }

    intro();
    return {
      destroy() { dead = true; clear(); box.replaceChildren(); delete box.dataset.phase; },
      // il server ha rifiutato la risposta: stessa griglia, di nuovo da 1
      retry() { if (!dead) play(); },
    };
  }

  // ---------------------------------------------------------------------
  // COLORE DELLA PAROLA (v6): 10 turni. Una parola-colore scritta con
  // l'inchiostro di un altro colore: si tocca il colore dell'INCHIOSTRO
  // (6 pulsanti col nome in nero, in ordine diverso a ogni turno: ordine
  // calcolato dai parametri del server, quindi uguale per la coppia).
  // Nessun limite per turno.
  // Errore → lampeggio rosso e si riparte dal turno 1 con parole nuove
  // (ogni tentativo usa la sequenza successiva del server).
  // Risposta: { tentativo, risposte: [10 inchiostri], tentativi }.
  // ---------------------------------------------------------------------
  const COLORI = ['ROSSO', 'BLU', 'VERDE', 'GIALLO', 'VIOLA', 'ARANCIONE'];

  // ordine dei pulsanti per il turno t del tentativo k: mescolato in modo
  // deterministico dai parametri (stessi parametri → stesso ordine),
  // mai uguale a quello del turno prima.
  function keyOrder(seq, k, t, prev) {
    let h = 2166136261 ^ (k * 131 + t * 7919);
    const src = JSON.stringify(seq);
    for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
    const rnd = () => {   // mulberry32
      h = (h + 0x6D2B79F5) | 0;
      let r = Math.imul(h ^ (h >>> 15), 1 | h);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
    const o = COLORI.map((_, i) => i);
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    if (prev && o.join() === prev.join()) o.push(o.shift());
    return o;
  }

  function coloreParola(box, params, opts) {
    const seqs = params.sequenze || [];
    const turns = Number(params.turni) || 10;
    let next = 0;       // prossima sequenza da usare
    let k = 0;          // sequenza del tentativo in corso
    let tries = 0;
    let timers = [];
    let dead = false;
    const later = (fn, ms) => { const t = setTimeout(() => { if (!dead) fn(); }, ms); timers.push(t); };
    const clear = () => { timers.forEach(clearTimeout); timers = []; };

    function intro() {
      box.replaceChildren();
      box.dataset.phase = 'intro';
      box.appendChild(el('p', turns + ' parole: tocca il colore dell\'INCHIOSTRO, non quello scritto. ' +
        'Un errore fa ripartire dal turno 1 con parole nuove.', 'hint'));
      const b = el('button', 'Inizia', 'game-start');
      b.type = 'button';
      b.addEventListener('click', newGame);
      box.appendChild(b);
    }

    function newGame() {
      clear();
      if (next >= seqs.length) {
        box.replaceChildren(el('p', 'Sequenze finite.', 'game-note bad'));
        box.dataset.phase = 'finite';
        return;
      }
      tries++;
      k = next++;
      const seq = seqs[k];
      const answers = [];
      let turn = 0;

      box.replaceChildren();
      box.dataset.phase = 'gioca';
      box.dataset.tentativo = String(tries);
      const dotsEl = el('div', null, 'cp-dots');
      const dotEls = [];
      for (let i = 0; i < turns; i++) { const d = el('span'); dotsEl.appendChild(d); dotEls.push(d); }
      box.appendChild(dotsEl);
      const note = el('p', '', 'game-note');
      box.appendChild(note);
      const word = el('div', '', 'cp-word');
      box.appendChild(word);
      const keys = el('div', null, 'cp-keys');
      const keyEls = COLORI.map((name, i) => {
        const b = el('button', name, 'cp-key');
        b.type = 'button';
        b.dataset.c = String(i);
        b.addEventListener('click', () => tap(i, b));
        keys.appendChild(b);
        return b;
      });
      box.appendChild(keys);

      let order = null;
      function show() {
        const [w, c] = seq[turn];
        order = keyOrder(seq, k, turn, order);
        keys.replaceChildren(...order.map((i) => keyEls[i]));
        box.dataset.ordine = order.join(',');
        box.dataset.turno = String(turn + 1);
        word.textContent = COLORI[w];
        word.className = 'cp-word cp-ink' + c;
        word.dataset.parola = String(w);
        word.dataset.inchiostro = String(c);
        note.textContent = 'Turno ' + (turn + 1) + ' di ' + turns + (tries > 1 ? ' · tentativo ' + tries : '');
        note.className = 'game-note';
        dotEls.forEach((d, i) => { d.className = i < turn ? 'cp-ok' : i === turn ? 'cp-now' : ''; });
      }

      function tap(i, b) {
        if (dead || box.dataset.phase !== 'gioca') return;
        if (i === seq[turn][1]) {
          answers.push(i);
          turn++;
          if (turn >= turns) {
            dotEls.forEach((d) => { d.className = 'cp-ok'; });
            keyEls.forEach((x) => { x.disabled = true; });
            note.textContent = 'Controllo…';
            box.dataset.phase = 'fine';
            opts.onDone({ tentativo: k, risposte: answers.slice(), tentativi: tries });
          } else {
            show();
          }
        } else {
          box.dataset.phase = 'errore';
          keyEls.forEach((x) => { x.disabled = true; });
          b.classList.add('cp-wrong');
          later(() => b.classList.remove('cp-wrong'), 300);
          note.textContent = 'Sbagliato! Si riparte dal turno 1…';
          note.className = 'game-note bad';
          later(newGame, 900);
        }
      }

      show();
    }

    intro();
    return {
      destroy() { dead = true; clear(); box.replaceChildren(); delete box.dataset.phase; },
      // il server ha rifiutato la risposta: nuovo tentativo con parole nuove
      retry() { if (!dead) newGame(); },
    };
  }

  const GAMES = { memoria, numeri, colore_parola: coloreParola };

  window.WBGames = {
    has: (code) => Object.prototype.hasOwnProperty.call(GAMES, code),
    mount(code, box, params, opts) {
      return GAMES[code](box, params || {}, opts || { onDone() {} });
    },
  };
})();
