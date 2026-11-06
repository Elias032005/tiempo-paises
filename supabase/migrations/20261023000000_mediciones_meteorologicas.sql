-- Tabla destino del pipeline ETL de Open-Meteo.
create table if not exists public.mediciones_meteorologicas (
  id bigint generated always as identity primary key,
  ciudad text not null,
  fecha_hora timestamptz not null,
  temperatura_c double precision not null,
  humedad_pct double precision not null,
  precipitacion_mm double precision not null,
  importado_en timestamptz not null default now(),

  constraint mediciones_meteorologicas_ciudad_fecha_hora_key unique (ciudad, fecha_hora),
  constraint mediciones_meteorologicas_ciudad_no_vacia check (length(trim(ciudad)) > 0),
  constraint mediciones_meteorologicas_humedad_rango check (humedad_pct between 0 and 100),
  constraint mediciones_meteorologicas_precipitacion_no_negativa check (precipitacion_mm >= 0)
);

comment on table public.mediciones_meteorologicas is
  'Mediciones horarias (UTC) extraídas de Open-Meteo. Una fila por ciudad y hora.';
comment on column public.mediciones_meteorologicas.importado_en is
  'Momento de la primera inserción. Un upsert posterior no lo modifica.';

-- RLS activado y sin políticas: los roles anon y authenticated no pueden leer
-- ni escribir. La aplicación accede solo desde el servidor con la clave
-- secreta (rol service_role), que omite RLS.
alter table public.mediciones_meteorologicas enable row level security;

-- La clave secreta omite RLS pero sigue necesitando permisos sobre la tabla.
revoke all on table public.mediciones_meteorologicas from anon, authenticated;
grant select, insert, update on table public.mediciones_meteorologicas to service_role;
