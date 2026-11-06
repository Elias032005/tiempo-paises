import type { ClaveRegistro } from "@/lib/etl/carga"
import { leerJsonLimitado, validarClaves } from "@/lib/etl/validacion-servidor"
import { comprobarAcceso } from "@/lib/supabase/proteccion"
import {
  clienteSupabase,
  explicarError,
  registrarError,
  TABLA,
} from "@/lib/supabase/servidor"

/** Fechas por consulta: mantiene la URL de PostgREST con un tamaño prudente. */
const FECHAS_POR_CONSULTA = 100

/** Devuelve cuáles de las claves recibidas existen ya en la tabla de destino. */
export async function POST(request: Request) {
  // Solo lee, pero recibe un cuerpo: aplicamos también la comprobación de origen.
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
  const claves = validarClaves(cuerpo.datos)
  if (!claves.ok) {
    return Response.json({ error: claves.error }, { status: 400 })
  }

  const porCiudad = new Map<string, string[]>()
  for (const c of claves.datos) {
    porCiudad.set(c.ciudad, [...(porCiudad.get(c.ciudad) ?? []), c.fecha_hora])
  }

  const existentes: ClaveRegistro[] = []
  for (const [ciudad, fechas] of porCiudad) {
    for (let i = 0; i < fechas.length; i += FECHAS_POR_CONSULTA) {
      const { data, error } = await supabase
        .from(TABLA)
        .select("ciudad, fecha_hora")
        .eq("ciudad", ciudad)
        .in("fecha_hora", fechas.slice(i, i + FECHAS_POR_CONSULTA))
      if (error) {
        registrarError("verificacion", error)
        return Response.json({ error: explicarError(error) }, { status: 502 })
      }
      existentes.push(...(data ?? []))
    }
  }
  return Response.json({ existentes })
}
