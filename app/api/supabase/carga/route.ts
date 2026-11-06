import {
  leerJsonLimitado,
  validarLoteCarga,
} from "@/lib/etl/validacion-servidor"
import { comprobarAcceso } from "@/lib/supabase/proteccion"
import {
  clienteSupabase,
  explicarError,
  registrarError,
  TABLA,
} from "@/lib/supabase/servidor"

/**
 * Recibe un lote (≤ 500 registros), lo valida de nuevo y hace un upsert
 * por (ciudad, fecha_hora). Supabase no indica qué filas se insertaron y
 * cuáles se actualizaron, así que solo se devuelve el total procesado.
 */
export async function POST(request: Request) {
  const bloqueo = comprobarAcceso(request, { escritura: true })
  if (bloqueo) return bloqueo

  const supabase = clienteSupabase()
  if (!supabase) {
    return Response.json(
      { error: "Supabase no está configurado en el servidor." },
      { status: 503 }
    )
  }

  const cuerpo = await leerJsonLimitado(request)
  if (!cuerpo.ok) {
    return Response.json({ error: cuerpo.error }, { status: 413 })
  }
  const lote = validarLoteCarga(cuerpo.datos)
  if (!lote.ok) {
    return Response.json(
      { error: lote.error, detalles: lote.detalles },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from(TABLA)
    .upsert(lote.datos, {
      onConflict: "ciudad,fecha_hora",
      ignoreDuplicates: false,
    })
    .select("ciudad, fecha_hora")

  if (error) {
    registrarError("carga", error)
    return Response.json({ error: explicarError(error) }, { status: 502 })
  }
  return Response.json({
    recibidos: lote.datos.length,
    procesados: data?.length ?? 0,
  })
}
