-- Apertura 2026 · Fútbol en Familia
-- Esquema, RLS y funciones de carga. Se corre entero, una sola vez,
-- en el SQL Editor del proyecto de Supabase.
--
-- Modelo de seguridad:
--   · La anon key es pública y está en el repo. Sirve para leer la tabla y nada más.
--   · Escribir solo se puede llamando a las funciones de abajo, que son SECURITY
--     DEFINER y validan la clave de carga contra un hash guardado en una tabla
--     que anon no puede leer.
--   · anon no tiene insert, update ni delete sobre fechas.

create extension if not exists pgcrypto with schema extensions;

-- ---------- tablas ----------

create table if not exists public.fechas (
  n          int primary key,
  dia        text   not null default '',
  equipo_a   text[] not null,
  equipo_b   text[] not null,
  goles_a    int    not null check (goles_a >= 0),
  goles_b    int    not null check (goles_b >= 0),
  goleadores jsonb  not null default '{}'::jsonb,
  creado     timestamptz not null default now()
);

-- una sola fila, con el hash de la clave de carga
create table if not exists public.torneo_config (
  id         smallint primary key default 1 check (id = 1),
  clave_hash text not null
);

-- el pozo: una sola fila con la cuota por presencia y un ajuste manual
create table if not exists public.pozo (
  id     smallint primary key default 1 check (id = 1),
  cuota  int  not null default 500 check (cuota >= 0),
  ajuste int  not null default 0,
  nota   text not null default ''
);
insert into public.pozo (id) values (1) on conflict (id) do nothing;

alter table public.fechas        enable row level security;
alter table public.pozo          enable row level security;
alter table public.torneo_config enable row level security;

-- fechas: lectura abierta a cualquiera con la anon key
drop policy if exists "lectura publica de fechas" on public.fechas;
create policy "lectura publica de fechas"
  on public.fechas for select to anon, authenticated using (true);

drop policy if exists "lectura publica del pozo" on public.pozo;
create policy "lectura publica del pozo"
  on public.pozo for select to anon, authenticated using (true);

-- torneo_config: sin políticas. Con RLS activo y sin policy, anon no la ve.

revoke insert, update, delete on public.fechas from anon, authenticated;
grant  select                  on public.fechas to   anon, authenticated;
revoke insert, update, delete on public.pozo   from anon, authenticated;
grant  select                  on public.pozo   to   anon, authenticated;
revoke all on public.torneo_config from anon, authenticated;

-- La clave de carga NO se define acá: se pone en una segunda consulta, aparte,
-- para que nunca pase por el repo. Ver el final de este archivo.
-- Hasta que se defina, torneo_config está vacía y verificar_clave devuelve
-- false para cualquier clave: nadie puede escribir.

-- ---------- funciones ----------

create or replace function public.clave_ok(p_clave text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.torneo_config
    where id = 1 and clave_hash = crypt(p_clave, clave_hash)
  );
$$;
revoke execute on function public.clave_ok(text) from public, anon, authenticated;

-- valida la clave sin escribir nada: la usa la pantalla de desbloqueo
create or replace function public.verificar_clave(p_clave text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$ select public.clave_ok(p_clave); $$;

-- carga una fecha nueva. El número lo decide la base, no el cliente.
create or replace function public.cargar_fecha(
  p_clave text, p_dia text, p_equipo_a text[], p_equipo_b text[],
  p_goles_a int, p_goles_b int, p_goleadores jsonb)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_n int;
begin
  if not public.clave_ok(p_clave) then
    raise exception 'clave incorrecta' using errcode = '42501';
  end if;
  if coalesce(array_length(p_equipo_a, 1), 0) = 0
     or coalesce(array_length(p_equipo_b, 1), 0) = 0 then
    raise exception 'faltan jugadores en alguno de los dos equipos';
  end if;
  if p_goles_a < 0 or p_goles_b < 0 then
    raise exception 'el marcador no puede ser negativo';
  end if;

  select coalesce(max(n), 0) + 1 into v_n from public.fechas;
  if v_n > 12 then
    raise exception 'el torneo tiene 12 fechas y ya están todas cargadas';
  end if;

  insert into public.fechas (n, dia, equipo_a, equipo_b, goles_a, goles_b, goleadores)
  values (v_n, coalesce(p_dia, ''), p_equipo_a, p_equipo_b,
          p_goles_a, p_goles_b, coalesce(p_goleadores, '{}'::jsonb));
  return v_n;
end;
$$;

-- borra cualquier fecha y renumera las que quedan, para que sigan siendo 1..N.
-- El rodeo por números negativos evita chocar con la clave primaria mientras
-- se corren de a uno: Postgres verifica la unicidad fila por fila.
create or replace function public.borrar_fecha(p_clave text, p_n int)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.clave_ok(p_clave) then
    raise exception 'clave incorrecta' using errcode = '42501';
  end if;
  delete from public.fechas where n = p_n;
  if not found then
    raise exception 'la fecha % no existe', p_n;
  end if;
  update public.fechas set n = -n        where n > p_n;
  update public.fechas set n = (-n) - 1  where n < 0;
  return (select count(*) from public.fechas);
end;
$$;

-- guarda la configuración del pozo
create or replace function public.guardar_pozo(p_clave text, p_cuota int,
                                               p_ajuste int, p_nota text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.clave_ok(p_clave) then
    raise exception 'clave incorrecta' using errcode = '42501';
  end if;
  if p_cuota < 0 then
    raise exception 'la cuota no puede ser negativa';
  end if;
  update public.pozo
     set cuota = p_cuota, ajuste = p_ajuste, nota = coalesce(p_nota, '')
   where id = 1;
end;
$$;

-- reemplaza todo el torneo por el contenido de un respaldo
create or replace function public.reemplazar_todo(p_clave text, p_fechas jsonb)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_c int;
begin
  if not public.clave_ok(p_clave) then
    raise exception 'clave incorrecta' using errcode = '42501';
  end if;
  if jsonb_typeof(p_fechas) <> 'array' then
    raise exception 'el respaldo tiene que ser una lista de fechas';
  end if;

  delete from public.fechas;
  insert into public.fechas (n, dia, equipo_a, equipo_b, goles_a, goles_b, goleadores)
  select (e->>'n')::int,
         coalesce(e->>'dia', ''),
         array(select jsonb_array_elements_text(e->'equipo_a')),
         array(select jsonb_array_elements_text(e->'equipo_b')),
         (e->>'goles_a')::int,
         (e->>'goles_b')::int,
         coalesce(e->'goleadores', '{}'::jsonb)
  from jsonb_array_elements(p_fechas) e;

  get diagnostics v_c = row_count;
  return v_c;
end;
$$;

-- solo estas tres quedan expuestas a la anon key
revoke execute on function public.verificar_clave(text)                                    from public;
revoke execute on function public.cargar_fecha(text, text, text[], text[], int, int, jsonb) from public;
revoke execute on function public.borrar_fecha(text, int)                                  from public;
revoke execute on function public.guardar_pozo(text, int, int, text)                       from public;
revoke execute on function public.reemplazar_todo(text, jsonb)                             from public;

grant execute on function public.verificar_clave(text)                                    to anon, authenticated;
grant execute on function public.cargar_fecha(text, text, text[], text[], int, int, jsonb) to anon, authenticated;
grant execute on function public.borrar_fecha(text, int)                                  to anon, authenticated;
grant execute on function public.guardar_pozo(text, int, int, text)                       to anon, authenticated;
grant execute on function public.reemplazar_todo(text, jsonb)                              to anon, authenticated;

drop function if exists public.borrar_ultima(text);

notify pgrst, 'reload schema';

-- ---------- clave de carga ----------
-- Correr esto aparte, cambiando el texto entre comillas por la clave real.
-- Sirve tanto para definirla la primera vez como para cambiarla después.
--
--   insert into public.torneo_config (id, clave_hash)
--   values (1, extensions.crypt('la-clave-del-torneo', extensions.gen_salt('bf')))
--   on conflict (id) do update set clave_hash = excluded.clave_hash;
