# Wake Battle — Decisioni (aggiornato 22/09/2026)

Architettura: web app (PWA) + sveglia dell'app Orologio + Comandi iOS. Niente app nativa (MacBook Air 2019 non supporta macOS Sequoia → niente Xcode 26 / AlarmKit).
Backend: Supabase (free). Hosting: GitHub Pages.

## Regole
1. Cronometro: dall'orario della sveglia fino al tocco del pulsante di fine/conferma nel gioco; orari registrati dal server. Snooze di Orologio disattivato. Il pulsante "Inizia" dei giochi NON ferma né fa ripartire il cronometro (nella pagina di prova il cronometro parte da "Prova", perché lì non c'è sveglia).
2. Limite: chi non completa entro 5 minuti dall'orario della sveglia perde. Il "Fatto" prima dell'orario della sveglia viene rifiutato.
3. Uscite dall'app consentite (nessuna penalità).
4. Orario sveglia: ognuno il suo, visibile al partner. Fuso orario unico Europe/Rome.
   Cambio orario: vale anche per oggi solo se il nuovo orario è almeno 30 minuti nel futuro (altrimenti vale da domani); dopo che la sveglia del giorno è suonata, quel giorno non cambia più.
5. Pareggio giornaliero (stesso tempo al decimo di secondo): mezzo punto a testa.
6. Challenge non completata: il punto va al partner. Se nessuno completa: nessun punto (confermato).
7. Giorno in cui anche solo uno dei due non ha la sveglia: non conta per nessuno.
8. Settimana: da lunedì a venerdì. Sabato e domenica niente sveglie. Verdetto sabato alle 12:00.
   Pareggio settimanale: vince il tempo totale più basso; una challenge non completata vale 5:00 (confermato).
9. Premio settimanale: testo libero, sempre modificabile da entrambi (fino al verdetto; dopo si scrive quello della settimana dopo).
10. Challenge: estratta a caso dal server, uguale per la coppia, mai uguale a quella del giorno precedente. Si scopre solo all'orario della propria sveglia.
11. Partner: si vedono solo i risultati finali (tempo del partner visibile solo a giornata chiusa: entrambi finito o scaduti i 5 min).
12. Storico: settimana in corso + vittorie delle settimane passate, nella schermata Sfida.
13. Accesso: email con codice a 6 cifre.

## Challenge definitive
Mondo reale / fisiche:
- QR o codice a barre: uno qualsiasi, nessuna registrazione.
- Accendi la luce (luminosità dalla fotocamera) — da verificare sul telefono, se inaffidabile si toglie.
- Caccia ai colori: sequenza di 5 colori (la challenge "Colore" singola è eliminata).
- Trova l'oggetto (riconoscimento oggetti: spazzolino, tazza, frigorifero, WC...).
- Occhi aperti (10 s senza battere le palpebre + battito finale richiesto).
- Esercizi: 10 piegamenti, 20 squat, 20 affondi, plank 30 s (uno estratto a caso). Video registrato dentro l'app, visibile solo alla coppia, cancellato dopo 48 h. Il tempo si ferma al tocco di "Fine registrazione"; il video può arrivare anche dopo. Il partner non può contestare il video.
Da schermo:
- Memoria (definitiva dal 22/09/2026): 5 round di fila; in ogni round 3 emoji diverse (su 9) visibili 3 s, poi da toccare nello stesso ordine; round riuscito → il successivo parte da solo ("Inizia" solo all'inizio); un tocco sbagliato → si riparte dal round 1 con emoji nuove.
- Numeri in ordine (definitiva dal 22/09/2026): griglia 5×5 con 1–25 in posizioni casuali del server, uguale per la coppia; coperta fino a "Inizia"; tocco giusto → casella spenta al suo posto, in alto "Prossimo: N"; errore → lampeggio rosso 0,3 s, nessuna penalità, si continua (errori mostrati solo a fine prova); al 25 la risposta parte da sola; risposta rifiutata → stessa griglia da 1. Server: params {gioco:'numeri', lato:5, disposizione:[25]}, risposta {tocchi:[posizione di 1..25]} verificata sulla disposizione.
- Colore della parola (definitiva dal 22/09/2026): 10 turni; parola-colore scritta con l'inchiostro di un ALTRO colore, si tocca il colore dell'inchiostro; 6 colori (rosso, blu, verde, giallo, viola, arancione), 6 pulsanti col nome in nero, in ordine diverso a ogni turno (mescolato dai parametri del server: uguale per la coppia, mai uguale al turno prima); nessun limite per turno; coperta fino a "Inizia"; errore → lampeggio rosso 0,3 s e si riparte dal turno 1 con parole nuove (tentativi mostrati a fine prova); al 10° giusto la risposta parte da sola; risposta rifiutata → nuovo tentativo. Server: params {gioco:'colore_parola', colori:6, turni:10, sequenze:[200×10×[parola, inchiostro]]} (parola ≠ inchiostro, inchiostro mai uguale al turno prima), risposta {tentativo, risposte:[10], tentativi} verificata su sequenze[tentativo].
- Trova l'intruso (definitiva dal 22/09/2026): 5 turni; in ogni turno griglia 3×3 di 9 emoji (stesso set di Memoria) tutte uguali tranne una, visibile 3 s, poi coperta; si tocca a memoria la casella dell'intrusa; turno riuscito → il successivo parte da solo ("Inizia" solo all'inizio); un tocco sbagliato → si riparte dal turno 1 con emoji/posizioni nuove (tentativi mostrati a fine prova); al 5° giusto la risposta parte da sola. Server: params {gioco:'intruso', elementi:9, turni:5, mostra_ms:3000, sequenze:[200×5×[base, intruso, posizione]]} (griglia compatta, non i 9 valori: il client la ricostruisce; posizione dell'intrusa mai uguale al turno prima), risposta {tentativo, risposte:[5 posizioni], tentativi} verificata su sequenze[tentativo][turno][2].
- Riflessi (5 volte; tocco in anticipo → turno ripetuto), anagramma (tentativi illimitati).
Nessun gioco usa il microfono.
Ogni gioco va provato singolarmente in una pagina di prova (beta) prima di attivarlo; nel database ogni challenge si può attivare/disattivare.
Eliminati: colore singolo, tocchi alternati, scrivi la frase, scuoti il telefono, rubinetto, batti le mani, canta, cammina, trova il nord, jumping jack, calcolo lampo.

## Comandi iOS
Sveglie di controllo in Orologio, disattivate dal comando "WB Fatto" a challenge completata e riattivate la sera da un'automazione. Automazione facoltativa "quando la sveglia viene fermata → apri l'app". L'app si usa da Safari (i Comandi aprono i link in Safari).
