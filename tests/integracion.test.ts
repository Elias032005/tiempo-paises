/**
 * Pruebas de integración con servicios reales. Se ejecutan con:
 *   npm run test:integracion
 * Usan datos REALES de Open-Meteo (nunca los fixtures controlados) y las
 * credenciales de .env.local. Escriben en Supabase 24 filas reales de
 * Barcelona (2026-09-01) mediante las mismas rutas que usa la aplicación.
 */
import { loadEnvConfig } from "@next/env"
import { describe, expect, it, vi } from "vitest"

import { buscarCiudad } from "@/lib/etl/ciudades"
import { descargarCiudad } from "@/lib/etl/extraccion"
import { aRegistroCarga } from "@/lib/etl/filtros"
import { limpiar } from "@/lib/etl/limpieza"
import { transformarCiudad } from "@/lib/etl/transformacion"

vi.mock("server-only", () => ({}))

const activas = process.env.INTEGRACION === "1"
if (activas) {
  // @next/env ignora .env.local cuando NODE_ENV=test (el valor de Vitest).
  const entorno = process.env as Record<string, string | undefined>
  const anterior = entorno.NODE_ENV
  entorno.NODE_ENV = "development"
  loadEnvConfig(process.cwd(), true, { info() {}, error() {} })
  entorno.NODE_ENV = anterior
}

function post(url: string, cuerpo: unknown) {
  return new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000" },
    body: JSON.stringify(cuerpo),
  })
}

describe.runIf(activas)("integración real", () => {
  let registros: ReturnType<typeof aRegistroCarga>[] = []

  it("Open-Meteo: Barcelona, 1 día → 24 registros horarios en UTC", async () => {
    const json = await descargarCiudad(
      buscarCiudad("Barcelona")!,
      "2026-09-01",
      "2026-09-01"
    )
    expect(json.utc_offset_seconds).toBe(0)
    const { registros: t } = transformarCiudad("Barcelona", json)
    const { validos } = limpiar(t)
    expect(t).toHaveLength(24)
    expect(validos).toHaveLength(24)
    expect(validos[0].fecha_hora).toBe("2026-09-01T00:00:00.000Z")
    expect(validos[23].fecha_hora).toBe("2026-09-01T23:00:00.000Z")
    registros = validos.map(aRegistroCarga)
  }, 30_000)

  it("Supabase: dos cargas seguidas no duplican filas y las claves se verifican", async () => {
    const { GET: estado } = await import("@/app/api/supabase/estado/route")
    const e = await (
      await estado(new Request("http://localhost:3000/api/supabase/estado"))
    ).json()
    if (!e.tablaAccesible) {
      throw new Error(`Integración con Supabase bloqueada: ${e.mensaje}`)
    }

    const { POST: cargar } = await import("@/app/api/supabase/carga/route")
    const { POST: verificar } =
      await import("@/app/api/supabase/verificacion/route")
    const { GET: datos } = await import("@/app/api/supabase/datos/route")

    const contar = async () => {
      const url =
        "http://localhost:3000/api/supabase/datos?ciudad=Barcelona" +
        "&desde=2026-09-01T00:00:00.000Z&hasta=2026-09-01T23:00:00.000Z&tamano=100"
      return (await (await datos(new Request(url))).json()).total as number
    }

    const r1 = await cargar(post("/api/supabase/carga", { registros }))
    expect(r1.status, JSON.stringify(await r1.clone().json())).toBe(200)
    expect((await r1.json()).procesados).toBe(24)
    expect(await contar()).toBe(24)

    const r2 = await cargar(post("/api/supabase/carga", { registros }))
    expect(r2.status).toBe(200)
    expect(await contar()).toBe(24)

    const v = await verificar(
      post("/api/supabase/verificacion", {
        claves: registros.map((r) => ({
          ciudad: r.ciudad,
          fecha_hora: r.fecha_hora,
        })),
      })
    )
    expect((await v.json()).existentes).toHaveLength(24)
  }, 60_000)
})
