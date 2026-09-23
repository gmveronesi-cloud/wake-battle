"""Libreria comune ai test SQL (test_0N.py): connessione, orologio finto, ruoli, rpc, contatori.
Uso: from _lib import T, cur, clock, as_user, admin, rpc, jrpc, check, expect_error, report
Orologio del server simulato: wb_now() legge 'wb.fake_now' (solo nei test)."""
import json
import sys

import psycopg2

conn = psycopg2.connect(host="/tmp", port=5433, user="postgres", dbname="wb")
conn.autocommit = True
cur = conn.cursor()


class _Counters:
    def __init__(self):
        self.passes = 0
        self.fails = 0


T = _Counters()

cur.execute("""
create or replace function public.wb_now() returns timestamptz
language sql stable set search_path = '' as
$$ select coalesce(nullif(current_setting('wb.fake_now', true), '')::timestamptz, now()) $$;
""")


def clock(ts):
    cur.execute("select set_config('wb.fake_now', %s, false)", (ts + "+02",))


def as_user(uid):
    cur.execute("reset role")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (uid or "",))
    cur.execute("set role " + ("authenticated" if uid else "anon"))


def admin():
    cur.execute("reset role")


def rpc(fn, *args):
    ph = ",".join(["%s"] * len(args))
    cur.execute(f"select public.{fn}({ph})", args)
    r = cur.fetchone()[0]
    return r if not isinstance(r, str) else json.loads(r)


_JRPC_CASTS = {"complete_game": ["jsonb"], "beta_check": ["text", "jsonb", "jsonb"],
               "save_object_photos": ["jsonb"]}


def jrpc(fn, *args):
    """rpc con argomenti jsonb espliciti (serve quando un argomento può essere
    null, lista o stringa: senza il cast psycopg2 non saprebbe che tipo mandare)."""
    casts = _JRPC_CASTS[fn]
    ph = ",".join(f"%s::{c}" for c in casts)
    vals = [a if c == "text" else json.dumps(a) for a, c in zip(args, casts)]
    cur.execute(f"select public.{fn}({ph})", vals)
    return cur.fetchone()[0]


def check(label, got, exp):
    if got == exp:
        T.passes += 1
    else:
        T.fails += 1
        print(f"FAIL {label}: atteso {exp!r}, ottenuto {got!r}")


def expect_error(label, sql, args=()):
    try:
        cur.execute(sql, args)
        T.fails += 1
        print(f"FAIL {label}: nessun errore")
    except psycopg2.Error:
        T.passes += 1


def report():
    """Da chiamare a fine test: stampa il riassunto ed esce con codice 1 se c'è stato un fallimento."""
    admin()
    print(f"\n{T.passes} controlli superati, {T.fails} falliti")
    sys.exit(1 if T.fails else 0)
