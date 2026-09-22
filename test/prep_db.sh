#!/bin/sh
# DB pulito per il test UI: sim Supabase + 01 + 02 + 03 (+ 04, 05... se presenti) + orologio finto
# Uso: sh test/prep_db.sh          (con 04)
#      sh test/prep_db.sh senza04  (solo fino a 03)
set -e
cd "$(dirname "$0")/.."
P="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists wb" -c "drop role if exists anon" -c "drop role if exists authenticated" -c "create database wb" 2>/dev/null
$P -d wb -f test/00_supabase_sim.sql
$P -d wb -f sql/01_coppia.sql
$P -d wb -f sql/02_sveglie_risultati.sql
$P -d wb -f sql/03_giochi.sql
if [ "$1" != "senza04" ]; then for f in sql/0[4-9]_*.sql sql/[1-9][0-9]_*.sql; do [ -f "$f" ] && $P -d wb -f "$f"; done; fi
$P -d wb -c "create or replace function public.wb_now() returns timestamptz language sql stable set search_path = '' as \$\$ select coalesce(nullif(current_setting('wb.fake_now', true), '')::timestamptz, now()) \$\$;"
