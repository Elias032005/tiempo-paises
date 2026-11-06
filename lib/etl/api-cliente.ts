import type { ClaveRegistro, ResultadoEnvio } from "./carga"
import type { RegistroCarga } from "./tipos"

async function leerRespuesta<T>(respuesta: Response): Promise<T> {
  let cuerpo: unknown = null
  try {
    cuerpo = await respuesta.json()
  } catch {
    // cuerpo vacío o no JSON
  }
  if (!respuesta.ok) {
    const c = cuerpo as { error?: string; detalles?: string[] } | null
    const detalle = c?.detalles?.length ? ` ${c.detalles.join(" · ")}` : ""
    throw new Error(`${c?.error ?? `HTTP ${respuesta.status}`}${detalle}`)
  }
  return cuerpo as T
}

export interface EstadoSupabase {
  configurado: boolean
  faltan: string[]
  tablaAccesible: boolean
  totalFilas?: number
  mensaje: string
}

export async function consultarEstado(): Promise<EstadoSupabase> {
  return leerRespuesta(
    await fetch("/api/supabase/estado", { cache: "no-store" })
  )
}

export async function enviarLote(
  registros: readonly RegistroCarga[]
): Promise<ResultadoEnvio> {
  const respuesta = await fetch("/api/supabase/carga", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registros }),
  })
  const { procesados } = await leerRespuesta<{ procesados: number }>(respuesta)
  return { procesados }
}

export async function consultarExistentes(
  claves: ClaveRegistro[]
): Promise<ClaveRegistro[]> {
  const respuesta = await fetch("/api/supabase/verificacion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claves }),
  })
  const { existentes } = await leerRespuesta<{ existentes: ClaveRegistro[] }>(
    respuesta
  )
  return existentes
}

export interface FilaPersistida extends RegistroCarga {
  id: number
  importado_en: string
}

export interface ParametrosDatos {
  ciudad: string
  desde: string
  hasta: string
  orden: string
  direccion: "asc" | "desc"
  pagina: number
  tamano: number
}

export async function consultarDatos(
  p: ParametrosDatos
): Promise<{ filas: FilaPersistida[]; total: number }> {
  const params = new URLSearchParams({
    orden: p.orden,
    direccion: p.direccion,
    pagina: String(p.pagina),
    tamano: String(p.tamano),
  })
  if (p.ciudad) params.set("ciudad", p.ciudad)
  if (p.desde) params.set("desde", p.desde)
  if (p.hasta) params.set("hasta", p.hasta)
  return leerRespuesta(
    await fetch(`/api/supabase/datos?${params}`, { cache: "no-store" })
  )
}
