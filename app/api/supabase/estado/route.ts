import { comprobarAcceso } from "@/lib/supabase/proteccion"
import {
  clienteSupabase,
  explicarError,
  registrarError,
  TABLA,
  variablesQueFaltan,
} from "@/lib/supabase/servidor"

export const dynamic = "force-dynamic"

/** Indica si Supabase está configurado y si la tabla de destino es accesible. */
export async function GET(request: Request) {
  const bloqueo = comprobarAcceso(request, { escritura: false })
  if (bloqueo) return bloqueo

  const supabase = clienteSupabase()
  if (!supabase) {
    return Response.json({
      configurado: false,
      faltan: variablesQueFaltan(),
      tablaAccesible: false,
      mensaje: "Faltan variables de entorno de Supabase en el servidor.",
    })
  }

  // GET y no HEAD: una petición HEAD sobre una tabla inexistente responde 204
  // sin error, lo que daría un falso "conectado".
  const { count, error } = await supabase
    .from(TABLA)
    .select("id", { count: "exact" })
    .limit(1)
  if (error) {
    registrarError("estado", error)
    return Response.json({
      configurado: true,
      faltan: [],
      tablaAccesible: false,
      mensaje: explicarError(error),
    })
  }
  return Response.json({
    configurado: true,
    faltan: [],
    tablaAccesible: true,
    totalFilas: count ?? 0,
    mensaje: `Conectado. La tabla ${TABLA} contiene ${count ?? 0} filas.`,
  })
}
