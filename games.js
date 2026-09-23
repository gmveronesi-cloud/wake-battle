'use strict';
// Wake Battle — giochi (v18). Usato sia dall'app (sfida vera) sia da beta.html (prova).
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

  // =====================================================================
  // FOTOCAMERA — funzioni GENERICHE (v14), riusabili da TUTTI i giochi con
  // fotocamera (Accendi la luce, e poi QR/barcode, Caccia ai colori, Occhi
  // aperti, Trova l'oggetto): chiedono il permesso, creano un <video>
  // nascosto (mai il feed live a schermo) e un <canvas> interno, e fanno
  // partire un ciclo che cattura un frame ogni tot ms e lo passa alla
  // funzione di analisi DEL GIOCO SPECIFICO. Un gioco nuovo con fotocamera
  // riusa cameraGame() così com'è e scrive solo la sua onFrame(frame, ctrl)
  // (vedi più sotto "ACCENDI LA LUCE" per un esempio).
  // =====================================================================

  // cattura un frame ogni intervalMs: disegna il <video> su un <canvas>
  // interno (mai mostrato) e chiama onFrame(ImageData a colori, lato
  // sample × sample px). Ritorna una funzione per fermare il ciclo.
  function cameraLoop(video, sample, onFrame, intervalMs) {
    const canvas = document.createElement('canvas');
    canvas.width = sample;
    canvas.height = sample;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let stopped = false;
    const timer = setInterval(() => {
      if (stopped || video.readyState < 2) return;
      ctx.drawImage(video, 0, 0, sample, sample);
      onFrame(ctx.getImageData(0, 0, sample, sample));
    }, intervalMs);
    return () => { stopped = true; clearInterval(timer); };
  }

  // UI comune di un gioco con fotocamera: intro con spiegazione + "Inizia"
  // -> chiede il permesso -> barra generica aggiornabile dal gioco tramite
  // ctrl.setLevel() -> ctrl.finish(risposta) chiude la fotocamera e chiama
  // onDone(risposta). Permesso negato/fotocamera assente -> messaggio con
  // "Riprova" (nessun timeout dedicato: il limite è quello della sveglia).
  // opts: { hint, sample (lato canvas interno, default 32),
  //         intervalMs (default 120), onFrame(frame, ctrl),
  //         showVideo (default false: video nascosto, come "Accendi la
  //           luce", dove basta un punto di luce e vedere l'inquadratura
  //           non aiuta; true per i giochi dove serve inquadrare qualcosa
  //           di preciso, es. QR/barcode),
  //         showBar (default true: barra del livello; false per i giochi
  //           dove non ha un significato continuo, es. QR/barcode: o si è
  //           letto un codice o no, niente da mostrare in progressione) }
  function cameraGame(box, opts, onDone) {
    let stream = null;
    let stopLoop = null;
    let dead = false;

    function stopStream() {
      if (stopLoop) { stopLoop(); stopLoop = null; }
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    }

    function intro() {
      box.replaceChildren();
      box.dataset.phase = 'intro';
      box.appendChild(el('p', opts.hint, 'hint'));
      const b = el('button', 'Inizia', 'game-start');
      b.type = 'button';
      b.addEventListener('click', start);
      box.appendChild(b);
    }

    function errorUI(text) {
      box.replaceChildren();
      box.dataset.phase = 'errore-camera';
      box.appendChild(el('p', text, 'game-note bad'));
      const b = el('button', 'Riprova', 'game-start');
      b.type = 'button';
      b.addEventListener('click', start);
      box.appendChild(b);
    }

    async function start() {
      box.replaceChildren();
      box.dataset.phase = 'permesso';
      box.appendChild(el('p', 'Attendo il permesso della fotocamera…', 'game-note'));
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        errorUI('Fotocamera non disponibile su questo browser.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch (e) {
        errorUI('Fotocamera non disponibile o permesso negato.');
        return;
      }
      if (dead) { stream.getTracks().forEach((t) => t.stop()); stream = null; return; }
      const video = document.createElement('video');
      video.srcObject = stream;
      video.playsInline = true;
      video.muted = true;
      video.hidden = !opts.showVideo;   // nascosto di default; visibile solo se il gioco chiede di inquadrare qualcosa di preciso
      if (opts.showVideo) video.className = 'cam-video';
      await video.play().catch(() => {});
      if (dead) { stopStream(); return; }
      box.replaceChildren();
      box.dataset.phase = 'gioca';
      const note = el('p', '', 'game-note');
      box.appendChild(note);
      let fill = null;
      if (opts.showBar !== false) {
        const bar = el('div', null, 'bar game-bar cam-bar');
        fill = el('div');
        bar.appendChild(fill);
        box.appendChild(bar);
      }
      box.appendChild(video);
      const ctrl = {
        setLevel(pct, text) {
          if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
          if (text != null) note.textContent = text;
        },
        finish(answer) {
          if (dead || box.dataset.phase !== 'gioca') return;
          stopStream();
          box.dataset.phase = 'fine';
          note.textContent = 'Controllo…';
          onDone(answer);
        },
      };
      stopLoop = cameraLoop(video, opts.sample || 32, (frame) => opts.onFrame(frame, ctrl), opts.intervalMs || 120);
    }

    intro();
    return {
      destroy() { dead = true; stopStream(); box.replaceChildren(); delete box.dataset.phase; },
      // il server ha rifiutato la risposta: si richiede di nuovo (nessun dato da rigenerare)
      retry() { if (!dead) { stopStream(); start(); } },
    };
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

  // ---------------------------------------------------------------------
  // RIFLESSI (v11): dopo un'attesa casuale del server compaiono due riquadri
  // uguali affiancati, "BABBO" e "SCHIACCIAMI!" (posizione che si alterna a
  // ogni round: pubblica, non serve dal server), per mostra_ms; poi si
  // oscurano restando nella stessa posizione (vuoti ma cliccabili). Tocchi
  // "SCHIACCIAMI!" → round successivo. Tocchi "BABBO" → si riparte dal
  // round 1 con dati nuovi (come Colore della parola/Intruso). 5 round di
  // fila per finire. Risposta: { tentativo, tentativi }.
  // ---------------------------------------------------------------------
  function riflessi(box, params, opts) {
    const seqs = params.sequenze || [];
    const rounds = Number(params.round) || 5;
    const showMs = Number(params.mostra_ms) || 400;
    let next = 0;    // prossima sequenza (tentativo) da usare
    let start = 0;   // sequenza di inizio del tentativo in corso
    let round = 0;   // round in corso nel tentativo (0-based)
    let tries = 0;
    let timers = [];
    let dead = false;
    const later = (fn, ms) => { const t = setTimeout(() => { if (!dead) fn(); }, ms); timers.push(t); };
    const clear = () => { timers.forEach(clearTimeout); timers = []; };

    function intro() {
      box.replaceChildren();
      box.dataset.phase = 'intro';
      box.appendChild(el('p', 'Dopo un\'attesa compaiono due riquadri uguali per meno di un secondo, poi restano ' +
        'al loro posto ma vuoti. Tocca "SCHIACCIAMI!": se tocchi "BABBO" si riparte dal round 1. ' +
        rounds + ' round di fila per finire.', 'hint'));
      const b = el('button', 'Inizia', 'game-start');
      b.type = 'button';
      b.addEventListener('click', newGame);
      box.appendChild(b);
    }

    function dots() {
      const d = el('div', null, 'bb-dots');
      for (let i = 0; i < rounds; i++) d.appendChild(el('span', null, i < round ? 'done' : i === round ? 'now' : ''));
      return d;
    }

    function newGame() {
      clear();
      if (next >= seqs.length) {
        box.replaceChildren(el('p', 'Sequenze finite.', 'game-note bad'));
        box.dataset.phase = 'finite';
        return;
      }
      tries++;
      start = next++;
      round = 0;
      turn();
    }

    function turn() {
      clear();
      const wait = Number((seqs[start] || [])[round]) || 0;
      box.replaceChildren();
      box.dataset.phase = 'aspetta';
      box.dataset.round = String(round + 1);
      box.appendChild(dots());
      box.appendChild(el('p', 'Round ' + (round + 1) + ' di ' + rounds, 'game-note'));
      const row = el('div', null, 'bb-row');
      box.appendChild(row);
      later(() => reveal(row), wait);
    }

    function reveal(row) {
      const schiacciaDx = round % 2 === 0;   // la posizione si alterna a ogni round
      const mk = (label, ok) => {
        const c = el('div', label, 'bb-box');
        c.dataset.ok = ok ? '1' : '0';
        c.addEventListener('click', () => tap(ok, c));
        return c;
      };
      const left = mk(schiacciaDx ? 'BABBO' : 'SCHIACCIAMI!', !schiacciaDx);
      const right = mk(schiacciaDx ? 'SCHIACCIAMI!' : 'BABBO', schiacciaDx);
      row.replaceChildren(left, right);
      box.dataset.phase = 'mostra';
      later(() => {
        box.dataset.phase = 'oscurato';
        left.textContent = '';
        right.textContent = '';
        left.classList.add('bb-oscurato');
        right.classList.add('bb-oscurato');
      }, showMs);
    }

    function tap(ok, node) {
      if (dead || box.dataset.phase === 'fine' || box.dataset.phase === 'aspetta') return;
      clear();
      if (ok) {
        node.classList.add('bb-vinto');
        round++;
        if (round >= rounds) {
          box.dataset.phase = 'fine';
          opts.onDone({ tentativo: start, tentativi: tries });
        } else {
          box.dataset.phase = 'ok';
          later(turn, 500);
        }
      } else {
        node.classList.add('bb-wrong');
        box.dataset.phase = 'errore';
        later(newGame, 700);
      }
    }

    intro();
    return {
      destroy() { dead = true; clear(); box.replaceChildren(); delete box.dataset.phase; },
      // il server ha rifiutato la risposta: nuovo tentativo con dati nuovi
      retry() { if (!dead) newGame(); },
    };
  }

  // ---------------------------------------------------------------------
  // ANAGRAMMA (v12): 5 parole (lunghezza 5-7) di fila. Le lettere sono
  // mostrate mescolate come tessere; l'ordine del mescolamento è calcolato
  // in modo deterministico dalle lettere stesse (stessa parola -> stesso
  // mescolamento), quindi uguale per la coppia, come l'ordine dei pulsanti
  // di Colore della parola. Si toccano nell'ordine giusto per ricomporre
  // la parola.
  // Tentativi illimitati: tocco sbagliato -> lampeggio rosso 0,3 s,
  // nessuna penalità, si continua sulla STESSA parola (nessuna
  // ripartenza). Parola completata -> passa da sola alla successiva; dopo
  // la 5ª la risposta parte da sola. Risposta rifiutata dal server ->
  // nuovo tentativo con 5 parole nuove (come Colore della parola/Riflessi).
  // Risposta: { tentativo, risposte: [5 × lettere in ordine], tentativi }.
  // ---------------------------------------------------------------------
  function letterOrder(letters, seed) {
    let h = 2166136261 ^ seed;
    const src = letters.join('|');
    for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
    const rnd = () => {   // mulberry32
      h = (h + 0x6D2B79F5) | 0;
      let r = Math.imul(h ^ (h >>> 15), 1 | h);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
    const o = letters.map((_, i) => i);
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    if (o.length > 1 && o.every((v, i) => v === i)) o.push(o.shift());   // mai già in ordine
    return o;
  }

  function anagramma(box, params, opts) {
    const seqs = params.sequenze || [];
    const parole = Number(params.parole) || 5;
    let next = 0;    // prossimo tentativo (5 parole) da usare
    let k = 0;       // tentativo in corso
    let tries = 0;
    let timers = [];
    let dead = false;
    const later = (fn, ms) => { const t = setTimeout(() => { if (!dead) fn(); }, ms); timers.push(t); };
    const clear = () => { timers.forEach(clearTimeout); timers = []; };

    function intro() {
      box.replaceChildren();
      box.dataset.phase = 'intro';
      box.appendChild(el('p', parole + ' parole mescolate: tocca le lettere nell\'ordine giusto per ricomporle. ' +
        'Un tocco sbagliato lampeggia di rosso: nessuna penalità, continua.', 'hint'));
      const b = el('button', 'Inizia', 'game-start');
      b.type = 'button';
      b.addEventListener('click', newGame);
      box.appendChild(b);
    }

    function dots(word) {
      const d = el('div', null, 'ana-dots');
      for (let i = 0; i < parole; i++) d.appendChild(el('span', null, i < word ? 'done' : i === word ? 'now' : ''));
      return d;
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
      playWord(0, []);
    }

    function playWord(word, done) {
      clear();
      const letters = seqs[k][word];
      const order = letterOrder(letters, k * 97 + word);
      const picked = [];
      box.replaceChildren();
      box.dataset.phase = 'gioca';
      box.dataset.tentativo = String(tries);
      box.dataset.parola = String(word + 1);
      box.appendChild(dots(word));
      const note = el('p', 'Parola ' + (word + 1) + ' di ' + parole + (tries > 1 ? ' · tentativo ' + tries : ''), 'game-note');
      box.appendChild(note);
      const slots = el('div', null, 'ana-slots');
      const slotEls = letters.map(() => { const s = el('div', '', 'ana-slot'); slots.appendChild(s); return s; });
      box.appendChild(slots);
      const tiles = el('div', null, 'ana-tiles');
      order.map((li) => {
        const t = el('button', letters[li], 'ana-tile');
        t.type = 'button';
        t.addEventListener('click', () => tap(li, t));
        tiles.appendChild(t);
        return t;
      });
      box.appendChild(tiles);

      function tap(li, t) {
        if (dead || box.dataset.phase !== 'gioca' || t.disabled) return;
        if (letters[li] === letters[picked.length]) {
          picked.push(li);
          t.disabled = true;
          const slot = slotEls[picked.length - 1];
          slot.textContent = letters[li];
          slot.classList.add('ok');
          if (picked.length === letters.length) {
            const finished = done.concat([letters.slice()]);
            if (word + 1 >= parole) {
              box.dataset.phase = 'fine';
              note.textContent = 'Controllo…';
              note.className = 'game-note';
              opts.onDone({ tentativo: k, risposte: finished, tentativi: tries });
            } else {
              box.dataset.phase = 'ok';
              note.textContent = '✓ Parola trovata!';
              note.className = 'game-note good';
              later(() => playWord(word + 1, finished), 700);
            }
          }
        } else {
          t.classList.remove('ana-wrong');
          void t.offsetWidth; // fa ripartire il lampeggio
          t.classList.add('ana-wrong');
          later(() => t.classList.remove('ana-wrong'), 300);
        }
      }
    }

    intro();
    return {
      destroy() { dead = true; clear(); box.replaceChildren(); delete box.dataset.phase; },
      // il server ha rifiutato la risposta: nuovo tentativo con parole nuove
      retry() { if (!dead) newGame(); },
    };
  }

  // ---------------------------------------------------------------------
  // ACCENDI LA LUCE (v16): usa cameraGame() sopra per tutta la parte
  // GENERICA (permesso, video nascosto, ciclo dei frame). SPECIFICO di
  // questo gioco: countHotPixels() e le soglie/durata qui sotto.
  // NON si guarda la media di tutto il frame (richiederebbe una stanza
  // intera ben illuminata): si contano i pixel SINGOLI vicini alla
  // saturazione (una lampadina/fascio di luce inquadrati da vicino
  // "bruciano" quella zona), così basta un punto di luce concentrato
  // anche con il resto della stanza al buio. "Accesa" = almeno
  // LUCE_MIN_HOT pixel così luminosi, mantenuto SENZA INTERRUZIONI per
  // almeno LUCE_MS_MIN (tempo reale: un solo frame sotto soglia e il
  // conto riparte da zero). Campionamento più fine del default (sample
  // 48 invece di 32) perché un punto piccolo si perde se il frame viene
  // rimpicciolito troppo. La barra mostra quanto ci si avvicina alla
  // soglia e poi il countdown dei secondi che mancano.
  // Nessun dato del sensore va al server: risposta { fatto: true }.
  // ---------------------------------------------------------------------
  const LUCE_SAMPLE = 48;          // lato del canvas interno (più fine del default 32)
  const LUCE_PIXEL_SOGLIA = 225;   // luminanza 0-255 di un SINGOLO pixel per contare come "punto di luce"
  const LUCE_MIN_HOT = 15;         // pixel così luminosi necessari (un pixel isolato non basta: è rumore)
  const LUCE_MS_MIN = 10000;       // millisecondi consecutivi col punto di luce rilevato

  function countHotPixels(frame) {
    const d = frame.data;
    let hot = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (l > LUCE_PIXEL_SOGLIA) hot++;
    }
    return hot;
  }

  function luce(box, params, opts) {
    let aboveSince = null;   // istante (ms) da cui si è ininterrottamente sopra soglia
    return cameraGame(box, {
      sample: LUCE_SAMPLE,
      hint: 'Inquadra una lampada spenta da vicino, poi accendila e tieni il punto di luce inquadrato: quando la fotocamera lo vede abbastanza concentrato per 10 secondi di fila si passa da soli.',
      onFrame(frame, ctrl) {
        const hot = countHotPixels(frame);
        const pct = Math.round(Math.min(100, (hot / LUCE_MIN_HOT) * 100));
        if (hot >= LUCE_MIN_HOT) {
          const now = Date.now();
          if (aboveSince == null) aboveSince = now;
          const left = Math.max(0, Math.ceil((LUCE_MS_MIN - (now - aboveSince)) / 1000));
          ctrl.setLevel(pct, left > 0 ? 'Luce rilevata: tieni ferma per altri ' + left + ' s' : 'Luce rilevata: fatto!');
          if (now - aboveSince >= LUCE_MS_MIN) ctrl.finish({ fatto: true });
        } else {
          aboveSince = null;
          ctrl.setLevel(pct, pct > 0 ? 'Punto di luce: ' + pct + '%' : 'Nessun punto di luce rilevato');
        }
      },
    }, opts.onDone);
  }

  // ---------------------------------------------------------------------
  // QR O CODICE A BARRE (v18): usa cameraGame() sopra per la parte GENERICA
  // (permesso, ciclo dei frame), ma A DIFFERENZA di "Accendi la luce" con
  // showVideo:true (bisogna vedere cosa si sta inquadrando per mirare bene)
  // e showBar:false (niente barra: o un codice è stato letto o no, non c'è
  // un livello progressivo da mostrare). SPECIFICO: decodeFrame(), che usa
  // la libreria ZXing (vendor/zxing.js, inclusa nel sito senza CDN; nessun
  // worker/wasm/blob, quindi CSP invariata) per cercare un QR o un codice a
  // barre in ogni frame. Non serve nessun tempo di mantenimento: basta UNA
  // lettura valida (i formati hanno un controllo di integrità incorporato,
  // niente falsi positivi) e si finisce subito. Frame più grande del
  // default (360 invece di 32/48) perché decodificare richiede molto più
  // dettaglio della sola luminosità media; scansione ogni 300 ms (il
  // decoder è più pesante di un semplice conteggio di pixel). Nessun dato
  // del sensore va al server: risposta { fatto: true }.
  // ---------------------------------------------------------------------
  const QR_SAMPLE = 360;
  const QR_INTERVAL_MS = 300;

  function decodeFrame(frame, reader) {
    const d = frame.data;
    const n = frame.width * frame.height;
    const luminances = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      luminances[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    }
    const source = new ZXing.RGBLuminanceSource(luminances, frame.width, frame.height);
    const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
    try {
      return reader.decodeWithState(bitmap).getText();
    } catch (e) {
      return null;   // nessun codice in questo frame: non è un errore, si continua
    }
  }

  function qr(box, params, opts) {
    const reader = new ZXing.MultiFormatReader();
    return cameraGame(box, {
      sample: QR_SAMPLE,
      intervalMs: QR_INTERVAL_MS,
      showVideo: true,
      showBar: false,
      hint: 'Inquadra un QR o un codice a barre qualsiasi (va bene un\'etichetta o una confezione qualunque): appena viene letto si passa da soli.',
      onFrame(frame, ctrl) {
        const text = decodeFrame(frame, reader);
        if (text != null) {
          ctrl.setLevel(null, 'Codice letto: fatto!');
          ctrl.finish({ fatto: true });
        } else {
          ctrl.setLevel(null, 'Inquadra il codice…');
        }
      },
    }, opts.onDone);
  }

  const GAMES = { memoria, numeri, colore_parola: coloreParola, riflessi, anagramma, luce, qr };

  window.WBGames = {
    has: (code) => Object.prototype.hasOwnProperty.call(GAMES, code),
    mount(code, box, params, opts) {
      return GAMES[code](box, params || {}, opts || { onDone() {} });
    },
  };
})();
