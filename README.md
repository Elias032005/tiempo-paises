# Pipeline ETL: Open-Meteo → Supabase

Aplicación didáctica (Next.js 16 + TypeScript + Tailwind + shadcn/ui) para la
primera práctica de Big Data. Extrae datos meteorológicos horarios de la API
histórica de Open-Meteo, los transforma, limpia y filtra, y carga en Supabase
exactamente los registros que el alumno selecciona.

## Instalación

```bash
npm install
cp .env.example .env.local   # y rellena los valores
```

| Variable | Dónde se usa | Notas |
| --- | --- | --- |
| `SUPABASE_URL` | servidor | URL del proyecto. También se acepta `NEXT_PUBLIC_SUPABASE_URL`. |
| `SUPABASE_SECRET_KEY` | **solo servidor** | Clave `sb_secret_…` (o la *service_role* antigua en `SUPABASE_SERVICE_ROLE_KEY`). Nunca con prefijo `NEXT_PUBLIC_`. |
| `OPENAI_API_KEY` | **solo servidor** | Clave API de OpenAI para el chat. Configúrala también en Vercel como variable de entorno; nunca uses el prefijo `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_MAPTILER_KEY` | navegador | Opcional. Mapas base de MapTiler; sin ella se usa OpenFreeMap. |
| `ETL_PERMITIR_EN_PRODUCCION` | servidor | Opcional. Ver «Seguridad». |

La clave publicable no es necesaria: el navegador nunca habla con Supabase.
El chat usa la API de OpenAI desde el servidor. Como no requiere inicio de sesión,
cualquier visitante puede enviar mensajes y consumir la cuota de la cuenta cuya
clave esté configurada.

### Crear la tabla

Ejecuta [`supabase/migrations/20261023000000_mediciones_meteorologicas.sql`](supabase/migrations/20261023000000_mediciones_meteorologicas.sql)
en **Supabase → SQL Editor** (o `supabase db push` si usas la CLI). Crea la
tabla `mediciones_meteorologicas` con `UNIQUE (ciudad, fecha_hora)`, `CHECK`
de humedad (0–100) y precipitación (≥ 0), RLS activado sin políticas públicas y
los `GRANT` explícitos para `service_role` que Supabase exige a las tablas
nuevas desde 2026.

## Ejecución

```bash
npm run dev                # http://localhost:3000
npm test                   # pruebas unitarias (sin red)
npm run test:integracion   # Open-Meteo y Supabase reales (requiere .env.local y la tabla)
npm run typecheck && npm run lint && npm run build
```

## El pipeline

```
Extracción → Transformación → Limpieza → Filtrado y selección → Carga
```

1. **Extracción.** Una petición por ciudad a
   `archive-api.open-meteo.com/v1/archive` con `temperature_2m`,
   `relative_humidity_2m` y `precipitation`, `timezone=UTC`, °C y mm. Máximo 31
   días. El JSON original se guarda en memoria durante la sesión y se puede
   descargar. Si una ciudad falla, se reintenta solo esa ciudad y sus datos
   sustituyen a los anteriores (no se suman).
2. **Transformación.** Los arrays paralelos de `hourly` se convierten en un
   registro por ciudad y hora: `ciudad, fecha_hora, temperatura_c, humedad_pct,
   precipitacion_mm`. Se comprueba que los arrays tengan la misma longitud. La
   hora (`"2026-09-01T13:00"`, sin zona) se interpreta explícitamente en UTC
   usando `utc_offset_seconds`. `null`, `""` o valores ausentes se quedan como
   `null` y se anotan como incidencias. **Nunca se convierten en 0.**
3. **Limpieza.** Se rechazan, con su motivo, los registros sin ciudad, sin
   fecha válida o sin alguna medición, con humedad fuera de 0–100 o con
   precipitación negativa. La temperatura no tiene umbrales. **Duplicados:**
   primero se valida y después, entre los válidos con la misma `ciudad +
   fecha_hora`, se conserva la *primera aparición* en el orden de extracción.
   Las demás se rechazan indicando qué posición se conservó.
4. **Filtrado y selección.** `válidos → filtros → ordenación → selección`.
   Filtros por ciudad, intervalo UTC, temperatura, humedad, precipitación y
   «solo lluvia» (> 0 mm). La paginación solo afecta a la vista.
   - **Selección automática (por defecto):** se selecciona todo lo que cumple
     los filtros y se recalcula al cambiarlos, así que la fase se completa sola.
   - **Selección manual:** al marcar o desmarcar cualquier fila (o vaciar la
     selección), se parte de lo que estaba seleccionado y se pasa a modo
     manual. Desde ese momento, cambiar los filtros ya no añade filas. Un botón
     permite volver al modo automático.

   Solo se suben las filas seleccionadas que *siguen* cumpliendo los filtros, y
   se indica cuántas quedan fuera. Los excluidos por filtros se muestran aparte
   de los rechazados por calidad.
5. **Carga.** Al pulsar «Subir N registros», se congela una copia del conjunto
   y de su orden. Se envía en lotes de ≤ 500 a `/api/supabase/carga`, que
   vuelve a validar y hace un *upsert* por `(ciudad, fecha_hora)`. Repetir la
   carga no crea duplicados. Cada lote muestra su estado real. Un lote fallido
   no anula los anteriores y se puede reintentar solo él. Supabase no distingue
   insertados de actualizados en un upsert, así que se informa de *procesados*.
   Al terminar, se consulta por lotes que todas las claves existen en destino.

La tabla SQL no conserva el orden de inserción. Para leer los datos ordenados,
usa siempre `ORDER BY` (la pestaña «Datos en Supabase» lo hace explícitamente).

## Seguridad

- Toda escritura y lectura de Supabase ocurre en *route handlers* del servidor
  (`app/api/supabase/*`). La clave secreta solo se lee en
  `lib/supabase/servidor.ts`, marcado con `server-only`.
- El servidor valida tipos, rangos, ciudades permitidas, campos extra,
  duplicados dentro del lote, ≤ 500 registros y ≤ 256 KB por petición.
- RLS activado, sin políticas: los roles `anon` y `authenticated` no tienen
  acceso.
- **El proyecto no tiene autenticación.** Los endpoints funcionan con
  `npm run dev` y responden 403 en producción salvo que se defina
  `ETL_PERMITIR_EN_PRODUCCION=true`. **Antes de publicar la aplicación hay que
  añadir autenticación** y proteger `/api/supabase/*`. Las peticiones de
  escritura con un `Origin` distinto se rechazan.
- Los logs solo registran el código y el mensaje de error de Supabase.

## Estructura

```
app/api/supabase/{estado,carga,verificacion,datos}/route.ts  endpoints de servidor
lib/etl/                 lógica pura del pipeline (testeable sin navegador)
lib/supabase/            cliente de servidor y protección de endpoints
hooks/use-pipeline-etl.ts estado de la pantalla
components/etl/          interfaz (pipeline, contadores, pestañas, tablas)
supabase/migrations/     SQL de la tabla
tests/                   pruebas; tests/fixtures/controlado-* son datos FICTICIOS solo para pruebas
```
