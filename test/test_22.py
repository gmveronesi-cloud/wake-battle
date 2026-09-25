"""Test del Passo 4, rifinitura 3/3 (bilanciamento dell'estrazione) su
Postgres locale che simula Supabase. Richiede DB con 00 + 01..22 caricati.

Non testa i singoli giochi (già coperti da test_04..test_19): qui solo la
logica di wb_ensure_challenge -> mai la stessa challenge due giorni di
fila (anche a cavallo del weekend), mai più di 3/2 della stessa categoria
in una settimana lun-ven, alternanza della maggioranza tra settimane
consecutive, scelta casuale (non un ordine fisso) e a caso quando manca
la settimana precedente o è in parità."""
from datetime import date, timedelta

from _lib import admin, as_user, check, clock, cur, expect_error, report, rpc

FISICA = {"qr", "luce", "caccia_colori", "oggetto", "occhi", "esercizi"}
SCHERMO = {"memoria", "numeri", "colore_parola", "riflessi", "anagramma"}


def kind_of(code):
    if code in FISICA:
        return "fisica"
    if code in SCHERMO:
        return "schermo"
    raise ValueError(f"codice sconosciuto: {code}")


_n = [0]


def new_couple():
    _n[0] += 1
    admin()
    cur.execute("insert into auth.users (email) values (%s) returning id", (f"a{_n[0]}@x.it",)); a = str(cur.fetchone()[0])
    cur.execute("insert into auth.users (email) values (%s) returning id", (f"b{_n[0]}@x.it",)); b = str(cur.fetchone()[0])
    cur.execute("insert into public.couples (created_by) values (%s) returning id", (a,)); cp = cur.fetchone()[0]
    cur.execute("insert into public.couple_members (couple_id, user_id, joined_at) values (%s,%s,'2026-01-05 09:00+02'),(%s,%s,'2026-01-05 09:00+02')", (cp, a, cp, b))
    return a, b


def run_weeks(a, b, start_monday, n_weeks):
    """Sveglie impostate presto un lunedì mattina, poi fa scattare la
    challenge di ogni giorno lun-ven per n_weeks settimane di fila,
    tramite get_today() di 'a' (basta un solo membro: wb_ensure_challenge
    non richiede che la giornata 'conti', solo che la sveglia sia suonata).
    Restituisce una lista di settimane, ognuna lista di 5 codici."""
    clock(start_monday + " 05:00")
    as_user(a); rpc("set_alarm", "07:00", [1, 2, 3, 4, 5])
    as_user(b); rpc("set_alarm", "07:30", [1, 2, 3, 4, 5])
    d0 = date.fromisoformat(start_monday)
    weeks = []
    for w in range(n_weeks):
        codes = []
        for i in range(5):
            d = (d0 + timedelta(days=w * 7 + i)).isoformat()
            clock(d + " 07:00:05"); as_user(a)
            t = rpc("get_today")
            codes.append(t["io"]["challenge"]["codice"])
        weeks.append(codes)
    return weeks


def majority(codes):
    f = sum(1 for c in codes if kind_of(c) == "fisica")
    return "fisica" if f == 3 else "schermo"


# --- 6 settimane di fila per una coppia: quota 3/2, mai un ripetuto, alternanza ---
# (date scelte dentro l'ora legale: clock() di _lib.py somma sempre "+02",
# valido solo in ora legale — fuori da quella finestra l'orario Roma vero
# sarebbe un'ora indietro e la sveglia non risulterebbe ancora suonata)
a, b = new_couple()
weeks = run_weeks(a, b, "2026-04-06", 6)   # 2026-04-06 è un lunedì

flat = [c for w in weeks for c in w]
check("mai la stessa challenge in giorni consecutivi (anche a cavallo del weekend)",
      all(flat[i] != flat[i + 1] for i in range(len(flat) - 1)), True)

for i, w in enumerate(weeks):
    f = sum(1 for c in w if kind_of(c) == "fisica")
    s = 5 - f
    check(f"settimana {i + 1}: quota 3/2 (mai 4/1 o 5/0)", {f, s}, {3, 2})

maggioranze = [majority(w) for w in weeks]
check("alternanza: la maggioranza cambia ad ogni settimana",
      all(maggioranze[i] != maggioranze[i + 1] for i in range(len(maggioranze) - 1)), True)

# la scelta dentro la settimana non è un ordine fisso: tra le 6 settimane
# (stessa quota di categoria, quando coincide) l'ordine esatto dei 5 codici
# non è sempre lo stesso
check("non è un ordine prevedibile: non tutte le settimane sono identiche", len(set(tuple(w) for w in weeks)) > 1, True)

# --- assente/pari -> a caso: su molte coppie diverse (nessuna settimana
# precedente) la maggioranza della prima settimana non è sempre la stessa ---
prime_settimane = []
for i in range(12):
    a2, b2 = new_couple()
    w = run_weeks(a2, b2, "2026-06-01", 1)[0]   # 2026-06-01 è un lunedì, coppia mai vista prima
    prime_settimane.append(majority(w))
check("a caso: tra molte coppie senza storico compaiono entrambe le maggioranze",
      set(prime_settimane), {"fisica", "schermo"})

# --- rete di sicurezza: categoria interamente disabilitata ------------------
a3, b3 = new_couple()
admin()
cur.execute("update public.challenge_types set enabled = false where kind = 'fisica'")
w = run_weeks(a3, b3, "2026-07-06", 1)[0]   # lunedì, coppia dedicata
check("con la categoria 'fisica' disabilitata, tutte le 5 sono 'schermo' (nessun errore)",
      all(kind_of(c) == "schermo" for c in w), True)
admin()
cur.execute("update public.challenge_types set enabled = true where kind = 'fisica'")

# --- sicurezza: wb_ensure_challenge resta interna, come da 02 --------------
as_user(a)
expect_error("client non chiama wb_ensure_challenge", "select public.wb_ensure_challenge(gen_random_uuid(), current_date)")

report()
