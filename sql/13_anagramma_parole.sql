-- =====================================================================
-- Wake Battle — Anagramma: più parole (passo 3.6b)
-- Da incollare in Supabase > SQL Editor > New query > Run
-- Richiede 01..12 già eseguiti. Da lanciare UNA volta sola
-- (rilanciarlo per sbaglio non fa danni).
--
-- SOLO più varietà: nessuna regola di gioco cambia. Sostituisce
-- wb_gp_anagramma() (79 -> 146 parole possibili, sempre 5-7 lettere);
-- wb_ca_anagramma() e i dispatcher restano quelli del 12, non si toccano.
-- =====================================================================

create or replace function public.wb_gp_anagramma()
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  v_words text[] := array[
    'PORTA','LIBRO','GATTO','TRENO','FORNO','VERDE','PIZZA','SEDIA','FIUME','MONTE',
    'PONTE','CAMPO','LETTO','FIORE','CUORE','TORTA','PESCE','AMICO','FUOCO','VOLPE',
    'TIGRE','NONNA','NONNO','PANNA','CANNA','MERLO','LEONE','CIELO','VENTO','PRATO',
    'FUNGO','GESSO','SASSO','CASSA','TAZZA',
    'BANCO','LARGO','PRESA','FALCE','VIOLA','ROSSO','VERME','CORDA','LEPRE','BOSCO',
    'LARDO','BORSA','SCALA','TENDA','NOTTE','PIUME','FERRO','VETRO','GESTO','COSTA',
    'RENNA','PALLA','GONNA','COLPO','FORZA','SCOPA','BOTTE','GOCCE','CARRO','TORRE',
    'OMBRA','PENNA','GOMMA','VASCA','ZAINO',
    'NUVOLA','STELLA','NEBBIA','FRUTTA','TAVOLO','GIACCA','CUCINA','GIORNO','FARINA','SCUOLA',
    'MUSICA','GELATO','PATATA','FINALE','SALICE','DIVANO','GABBIA','SEDANO',
    'FOGLIA','STRADA','PIATTO','MAGLIA','SCARPA','NASTRO','LANCIA','SPUGNA','CORONA','BALENA',
    'TROMBA','RICCIO','SQUALO','POLIPO','MEDUSA','SAPONE','DOCCIA','MATITA','DIARIO',
    'BAMBINO','SORELLA','FRECCIA','PALLONE','ARANCIA','CANZONE','CAMICIA','CARTINA','MERCATO','CAMMINO',
    'BOTTONE','COLLINA','ARMADIO','FUMETTO','VULCANO','FONTANA','BALCONE','PALAZZO','PATTINO','SORRISO',
    'TAPPETO','FORMICA','GALLINA','CAMPANA','CANDELA','VALIGIA',
    'CAVALLO','VIOLINO','PENTOLA','GIRAFFA','DELFINO','GAMBERO','OSTRICA','CORTILE','SCALINO','CUSCINO',
    'PETTINE','LAMPADA','SVEGLIA'
  ];
  v_list    jsonb := '[]'::jsonb;
  v_seq     jsonb;
  v_word    text;
  v_letters jsonb;
  i int;
  j int;
begin
  for i in 1 .. 40 loop
    v_seq := '[]'::jsonb;
    for j in 1 .. 5 loop
      v_word := v_words[1 + floor(random() * array_length(v_words, 1))::int];
      select jsonb_agg(substring(v_word from n for 1) order by n) into v_letters
      from generate_series(1, length(v_word)) n;
      v_seq := v_seq || jsonb_build_array(v_letters);
    end loop;
    v_list := v_list || jsonb_build_array(v_seq);
  end loop;
  return jsonb_build_object('gioco', 'anagramma', 'parole', 5, 'sequenze', v_list);
end;
$$;

revoke all on function public.wb_gp_anagramma() from public, anon, authenticated;
