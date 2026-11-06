import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export const TABLA = "mediciones_meteorologicas"

interface Configuracion {
  url: string
  clave: string
}

/**
 * Lee la configuración solo en el servidor. La clave secreta (sb_secret_…)
 * nunca lleva el prefijo NEXT_PUBLIC_ y por tanto no llega al navegador.
 */
function leerConfiguracion(): Configuracion | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const clave =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !clave) return null
  return { url, clave }
}

export function variablesQueFaltan(): string[] {
  const faltan: string[] = []
  if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    faltan.push("SUPABASE_URL")
  }
  if (
    !process.env.SUPABASE_SECRET_KEY &&
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    faltan.push("SUPABASE_SECRET_KEY")
  }
  return faltan
}

let cliente: SupabaseClient | null = null

export function clienteSupabase(): SupabaseClient | null {
  if (cliente) return cliente
  const config = leerConfiguracion()
  if (!config) return null
  cliente = createClient(config.url, config.clave, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cliente
}

interface ErrorPostgrest {
  code?: string
  message?: string
}

/** Traduce los errores habituales a mensajes didácticos, sin exponer credenciales. */
export function explicarError(error: ErrorPostgrest): string {
  switch (error.code) {
    case "PGRST205":
    case "42P01":
      return `La tabla ${TABLA} no existe en Supabase. Aplica la migración de supabase/migrations.`
    case "42501":
      return `El rol del servidor no tiene permisos sobre ${TABLA}. Revisa los GRANT de la migración.`
    case "23514":
      return "Supabase rechazó algún registro por una restricción CHECK."
    case "21000":
      return "El lote contiene dos filas con la misma ciudad y fecha_hora."
    default:
      return `Error de Supabase${error.code ? ` (${error.code})` : ""}: ${error.message ?? "desconocido"}`
  }
}

/** Registro en consola sin datos sensibles: solo código y mensaje. */
export function registrarError(contexto: string, error: ErrorPostgrest) {
  console.error(`[${contexto}] ${error.code ?? "sin código"}: ${error.message}`)
}
