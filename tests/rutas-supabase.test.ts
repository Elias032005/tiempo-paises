import { beforeEach, describe, expect, it, vi } from "vitest"

import type { RegistroCarga } from "@/lib/etl/tipos"

vi.mock("server-only", () => ({}))

/**
 * Doble de Supabase en memoria que respeta UNIQUE (ciudad, fecha_hora) como
 * lo haría Postgres con ON CONFLICT DO UPDATE. Solo implementa lo que usan
 * las rutas. Las pruebas contra el Supabase real están en integracion.test.ts.
 */
const almacen = new Map<string, RegistroCarga & { id: number }>()
const llamadasUpsert: { filas: number; opciones: unknown }[] = []
let siguienteId = 1

function constructorConsulta() {
  const filtros: ((f: RegistroCarga) => boolean)[] = []
  const consulta = {
    eq(col: keyof RegistroCarga, v: unknown) {
      filtros.push((f) => f[col] === v)
      return consulta
    },
    in(col: keyof RegistroCarga, valores: unknown[]) {
      filtros.push((f) => valores.includes(f[col]))
      return consulta
    },
    then(resolver: (r: unknown) => void) {
      const data = [...almacen.values()]
        .filter((f) => filtros.every((fn) => fn(f)))
        .map((f) => ({
          ciudad: f.ciudad,
          fecha_hora: f.fecha_hora.replace(".000Z", "+00:00"),
        }))
      resolver({ data, error: null })
    },
  }
  return consulta
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      upsert(filas: RegistroCarga[], opciones: unknown) {
        llamadasUpsert.push({ filas: filas.length, opciones })
        for (const f of filas) {
          const clave = `${f.ciudad}|${f.fecha_hora}`
          const previo = almacen.get(clave)
          almacen.set(clave, { ...f, id: previo?.id ?? siguienteId++ })
        }
        return {
          select: async () => ({
            data: filas.map((f) => ({
              ciudad: f.ciudad,
              fecha_hora: f.fecha_hora,
            })),
            error: null,
          }),
        }
      },
      select: () => constructorConsulta(),
    }),
  }),
}))

process.env.SUPABASE_URL = "https://ejemplo.supabase.co"
process.env.SUPABASE_SECRET_KEY = "sb_secret_de_prueba"

const { POST: cargar } = await import("@/app/api/supabase/carga/route")
const { POST: verificar } =
  await import("@/app/api/supabase/verificacion/route")

function peticion(
  url: string,
  cuerpo: unknown,
  cabeceras: Record<string, string> = {}
) {
  return new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      ...cabeceras,
    },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  })
}

const registros: RegistroCarga[] = [0, 1, 2].map((h) => ({
  ciudad: "Valencia",
  fecha_hora: `2026-09-01T0${h}:00:00.000Z`,
  temperatura_c: 20 + h,
  humedad_pct: 60,
  precipitacion_mm: 0,
}))

beforeEach(() => {
  almacen.clear()
  llamadasUpsert.length = 0
})

describe("POST /api/supabase/carga", () => {
  it("hace upsert por (ciudad, fecha_hora) y una segunda carga no duplica", async () => {
    const r1 = await cargar(peticion("/api/supabase/carga", { registros }))
    expect(r1.status).toBe(200)
    expect(await r1.json()).toEqual({ recibidos: 3, procesados: 3 })

    const modificados = registros.map((r) => ({
      ...r,
      temperatura_c: r.temperatura_c + 1,
    }))
    const r2 = await cargar(
      peticion("/api/supabase/carga", { registros: modificados })
    )
    expect(r2.status).toBe(200)
    expect(almacen.size).toBe(3)
    expect(
      almacen.get("Valencia|2026-09-01T00:00:00.000Z")?.temperatura_c
    ).toBe(21)
    expect(llamadasUpsert[0].opciones).toEqual({
      onConflict: "ciudad,fecha_hora",
      ignoreDuplicates: false,
    })
  })

  it("vuelve a validar en el servidor y explica los motivos", async () => {
    const malos = [
      { ...registros[0], humedad_pct: 120 },
      { ...registros[1], temperatura_c: null },
      { ...registros[2], ciudad: "Gotham" },
      { ...registros[0], extra: 1 },
    ]
    const r = await cargar(
      peticion("/api/supabase/carga", { registros: malos })
    )
    expect(r.status).toBe(400)
    const cuerpo = await r.json()
    expect(cuerpo.detalles).toEqual([
      "#0: humedad_pct fuera de rango 0–100 (120)",
      "#1: Falta temperatura_c",
      '#2: ciudad desconocida "Gotham"',
      "#3: campos no permitidos: extra",
    ])
    expect(llamadasUpsert).toHaveLength(0)
  })

  it("rechaza lotes de más de 500, duplicados internos, cuerpos enormes y otros orígenes", async () => {
    const muchos = Array.from({ length: 501 }, (_, i) => ({
      ...registros[0],
      fecha_hora: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(),
    }))
    expect(
      (await cargar(peticion("/api/supabase/carga", { registros: muchos })))
        .status
    ).toBe(400)

    const dup = await cargar(
      peticion("/api/supabase/carga", {
        registros: [registros[0], registros[0]],
      })
    )
    expect((await dup.json()).detalles[0]).toMatch(/duplicada dentro del lote/)

    const enorme = JSON.stringify({ registros, relleno: "x".repeat(300_000) })
    expect((await cargar(peticion("/api/supabase/carga", enorme))).status).toBe(
      413
    )

    const ajeno = await cargar(
      peticion(
        "/api/supabase/carga",
        { registros },
        { origin: "https://malicioso.example" }
      )
    )
    expect(ajeno.status).toBe(403)
    expect(llamadasUpsert).toHaveLength(0)
  })
})

describe("POST /api/supabase/verificacion", () => {
  it("devuelve solo las claves que existen en destino", async () => {
    await cargar(
      peticion("/api/supabase/carga", { registros: registros.slice(0, 2) })
    )
    const r = await verificar(
      peticion("/api/supabase/verificacion", {
        claves: registros.map((x) => ({
          ciudad: x.ciudad,
          fecha_hora: x.fecha_hora,
        })),
      })
    )
    expect(r.status).toBe(200)
    const { existentes } = await r.json()
    expect(existentes).toHaveLength(2)
  })
})
