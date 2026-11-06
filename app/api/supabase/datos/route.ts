import { NOMBRES_CIUDADES } from "@/lib/etl/ciudades"
import { esFechaUtcValida } from "@/lib/etl/reglas"
import { comprobarAcceso } from "@/lib/supabase/proteccion"
import {
  clienteSupabase,
  explicarError,
  registrarError,
  TABLA,
} from "@/lib/supabase/servidor"

export const dynamic = "force-dynamic"

const COLUMNAS_ORDEN = [
  "ciudad",
  "fecha_hora",
  "temperatura_c",
  "humedad_pct",
  "precipitacion_mm",
  "importado_en",
  "id",
]
const MAX_TAMANO_PAGINA = 100

/** Lectura paginada de los datos persistidos en Supabase. */
export async function GET(request: Request) {
  const bloqueo = comprobarAcceso(request, { escritura: false })
  if (bloqueo) return bloqueo

  const supabase = clienteSupabase()
  if (!supabase) {
    return Response.json(
      { error: "Supabase no está configurado en el servidor." },
      { status: 503 }
    )
  }

  const p = new URL(request.url).searchParams
  const ciudad = p.get("ciudad") ?? ""
  const desde = p.get("desde") ?? ""
  const hasta = p.get("hasta") ?? ""
  const orden = p.get("orden") ?? "fecha_hora"
  const ascendente = p.get("direccion") !== "desc"
  const pagina = Number(p.get("pagina") ?? "1")
  const tamano = Number(p.get("tamano") ?? "25")

  if (ciudad && !NOMBRES_CIUDADES.includes(ciudad)) {
    return Response.json({ error: "Ciudad no válida." }, { status: 400 })
  }
  if (
    (desde && !esFechaUtcValida(desde)) ||
    (hasta && !esFechaUtcValida(hasta))
  ) {
    return Response.json({ error: "Fechas no válidas." }, { status: 400 })
  }
  if (!COLUMNAS_ORDEN.includes(orden)) {
    return Response.json(
      { error: "Columna de orden no válida." },
      { status: 400 }
    )
  }
  if (
    !Number.isInteger(pagina) ||
    pagina < 1 ||
    !Number.isInteger(tamano) ||
    tamano < 1 ||
    tamano > MAX_TAMANO_PAGINA
  ) {
    return Response.json({ error: "Paginación no válida." }, { status: 400 })
  }

  let consulta = supabase
    .from(TABLA)
    .select(
      "id, ciudad, fecha_hora, temperatura_c, humedad_pct, precipitacion_mm, importado_en",
      { count: "exact" }
    )
  if (ciudad) consulta = consulta.eq("ciudad", ciudad)
  if (desde) consulta = consulta.gte("fecha_hora", desde)
  if (hasta) consulta = consulta.lte("fecha_hora", hasta)

  // ORDER BY explícito: la base de datos no garantiza ningún orden por sí misma.
  consulta = consulta.order(orden, { ascending: ascendente })
  if (orden !== "id") consulta = consulta.order("id", { ascending: true })

  const inicio = (pagina - 1) * tamano
  const { data, count, error } = await consulta.range(
    inicio,
    inicio + tamano - 1
  )
  if (error) {
    registrarError("datos", error)
    return Response.json({ error: explicarError(error) }, { status: 502 })
  }
  return Response.json({ filas: data ?? [], total: count ?? 0 })
}
