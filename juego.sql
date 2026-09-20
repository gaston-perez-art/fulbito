-- La Torre · experimento
-- Tabla de récords del juego. Se corre entero, una sola vez, en el SQL Editor.
-- Es independiente de supabase.sql: si esto no se corre, el juego funciona
-- igual y muestra solo el récord del teléfono.
--
-- Sobre la seguridad: guardar_record NO pide la clave de carga, porque pedirla
-- para jugar mataría el juego. Eso significa que cualquiera que abra la consola
-- del navegador puede escribir el puntaje que quiera. Es una decisión tomada:
-- esto es un juego del grupo, no la tabla del torneo, y por eso vive en otra
-- tabla y con otra función. Lo único que valida el servidor es que el número
-- sea plausible y que nadie pueda bajarle el récord a otro.

create table if not exists public.torre_records (
  jugador   text primary key,
  altura    int not null check (altura >= 0 and altura <= 999),
  perfectos int not null default 0 check (perfectos >= 0),
  creado    timestamptz not null default now()
);

alter table public.torre_records enable row level security;

drop policy if exists "lectura publica de records" on public.torre_records;
create policy "lectura publica de records"
  on public.torre_records for select to anon, authenticated using (true);

revoke insert, update, delete on public.torre_records from anon, authenticated;
grant  select                  on public.torre_records to   anon, authenticated;

-- Guarda la marca solo si supera la que ya tenía ese jugador. Devuelve el
-- récord que quedó, que no siempre es el que se mandó.
create or replace function public.guardar_record(p_jugador text, p_altura int,
                                                 p_perfectos int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_mejor int;
begin
  if p_jugador is null or length(trim(p_jugador)) = 0 then
    raise exception 'falta el jugador';
  end if;
  if length(trim(p_jugador)) > 24 then
    raise exception 'el nombre no puede ser tan largo';
  end if;
  if p_altura is null or p_altura < 0 or p_altura > 999 then
    raise exception 'la altura está fuera de rango';
  end if;

  insert into public.torre_records (jugador, altura, perfectos)
  values (trim(p_jugador), p_altura, greatest(coalesce(p_perfectos, 0), 0))
  on conflict (jugador) do update
     set altura    = excluded.altura,
         perfectos = excluded.perfectos,
         creado    = now()
   where excluded.altura > public.torre_records.altura;

  select altura into v_mejor from public.torre_records where jugador = trim(p_jugador);
  return v_mejor;
end;
$$;

revoke execute on function public.guardar_record(text, int, int) from public;
grant  execute on function public.guardar_record(text, int, int) to anon, authenticated;

notify pgrst, 'reload schema';
