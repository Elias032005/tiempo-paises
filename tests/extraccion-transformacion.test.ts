import { describe, expect, it } from "vitest"

import { buscarCiudad } from "@/lib/etl/ciudades"
import {
  calcularVolumen,
  construirUrl,
  descargarCiudad,
  ErrorExtraccion,
  validarConfiguracion,
} from "@/lib/etl/extraccion"
import { limpiar } from "@/lib/etl/limpieza"
import type { RespuestaOpenMeteo } from "@/lib/etl/tipos"
import {
  interpretarFechaUtc,
  transformarCiudad,
} from "@/lib/etl/transformacion"

import controlado from "./fixtures/controlado-incidencias.json"
import realBarcelona from "./fixtures/real-barcelona-2026-09-01.json"

const barcelona = buscarCiudad("Barcelona")!

describe("extracción: petición y validación de la configuración", () => {
  it("pide las variables horarias en UTC, °C y mm", () => {
    const url = new URL(construirUrl(barcelona, "2026-09-01", "2026-09-30"))
    expect(url.origin + url.pathname).toBe(
      "https://archive-api.open-meteo.com/v1/archive"
    )
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      latitude: "41.3874",
      longitude: "2.1686",
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      hourly: "temperature_2m,relative_humidity_2m,precipitation",
      timezone: "UTC",
      temperature_unit: "celsius",
      precipitation_unit: "mm",
    })
  })

  it("acepta 31 días y rechaza 32", () => {
    const base = { ciudades: ["Madrid"], fechaInicio: "2026-08-01" }
    expect(
      validarConfiguracion({ ...base, fechaFin: "2026-08-31" }, "2026-10-26")
        .errores
    ).toEqual([])
    expect(
      validarConfiguracion({ ...base, fechaFin: "2026-09-01" }, "2026-10-26")
        .errores[0]
    ).toMatch(/32 días/)
  })

  it("detecta sin ciudades, fechas invertidas, inexistentes y futuras", () => {
    const hoy = "2026-10-26"
    expect(
      validarConfiguracion(
        { ciudades: [], fechaInicio: "2026-09-10", fechaFin: "2026-09-01" },
        hoy
      ).errores
    ).toEqual([
      "Selecciona al menos una ciudad.",
      "La fecha final debe ser igual o posterior a la inicial.",
    ])
    expect(
      validarConfiguracion(
        {
          ciudades: ["Bilbao"],
          fechaInicio: "2026-02-30",
          fechaFin: "2026-03-01",
        },
        hoy
      ).errores
    ).toContain("La fecha inicial no es válida.")
    expect(
      validarConfiguracion(
        {
          ciudades: ["Bilbao"],
          fechaInicio: "2026-10-26",
          fechaFin: "2026-10-27",
        },
        hoy
      ).errores
    ).toContain("La fecha final no puede ser posterior a hoy (UTC).")
  })

  it("calcula el volumen previsto: 5 ciudades × 30 días × 24 h", () => {
    expect(
      calcularVolumen({
        ciudades: ["Barcelona", "Madrid", "Sevilla", "Bilbao", "Valencia"],
        fechaInicio: "2026-09-01",
        fechaFin: "2026-09-30",
      })
    ).toEqual({
      dias: 30,
      horasPorCiudad: 720,
      registrosPrevistos: 3600,
      peticiones: 5,
    })
  })

  it("convierte la respuesta de error de la API en un mensaje legible", async () => {
    const falsoFetch = (async () =>
      new Response(JSON.stringify({ error: true, reason: "Bad Request" }), {
        status: 400,
      })) as typeof fetch
    await expect(
      descargarCiudad(barcelona, "2026-09-01", "2026-09-01", falsoFetch)
    ).rejects.toThrow(
      new ErrorExtraccion("Open-Meteo respondió HTTP 400: Bad Request.")
    )
  })
})

describe("transformación (1 ciudad, 1 día, respuesta real guardada)", () => {
  const { registros, diagnostico } = transformarCiudad(
    "Barcelona",
    realBarcelona as RespuestaOpenMeteo
  )

  it("genera 24 registros horarios en UTC", () => {
    expect(registros).toHaveLength(24)
    expect(diagnostico.coherente).toBe(true)
    expect(registros[0].fecha_hora).toBe("2026-09-01T00:00:00.000Z")
    expect(registros[23].fecha_hora).toBe("2026-09-01T23:00:00.000Z")
    const horas = registros.map((r) => new Date(r.fecha_hora!).getUTCHours())
    expect(horas).toEqual([...Array(24).keys()])
  })

  it("asocia cada posición i de los arrays paralelos al mismo registro", () => {
    const h = realBarcelona.hourly
    registros.forEach((r, i) => {
      expect(r.ciudad).toBe("Barcelona")
      expect(r.temperatura_c).toBe(h.temperature_2m[i])
      expect(r.humedad_pct).toBe(h.relative_humidity_2m[i])
      expect(r.precipitacion_mm).toBe(h.precipitation[i])
    })
  })

  it("todos superan la limpieza", () => {
    const { validos, rechazados } = limpiar(registros)
    expect(validos).toHaveLength(24)
    expect(rechazados).toHaveLength(0)
  })

  it("interpreta la hora como UTC de forma explícita, restando el desfase declarado", () => {
    expect(interpretarFechaUtc("2026-09-01T02:00", 0)).toBe(
      "2026-09-01T02:00:00.000Z"
    )
    expect(interpretarFechaUtc("2026-09-01T02:00", 7200)).toBe(
      "2026-09-01T00:00:00.000Z"
    )
    expect(interpretarFechaUtc("2026-02-30T00:00", 0)).toBeNull()
    expect(interpretarFechaUtc("2026-09-01T24:00", 0)).toBeNull()
    expect(interpretarFechaUtc(null, 0)).toBeNull()
  })
})

describe("transformación y limpieza con fixture controlado", () => {
  const { registros, diagnostico } = transformarCiudad(
    "Barcelona",
    controlado as RespuestaOpenMeteo
  )
  const { validos, rechazados, duplicados } = limpiar(registros)
  const motivosDe = (indice: number) =>
    rechazados.find((r) => r.registro.indice === indice)?.motivos

  it("detecta arrays de longitud distinta sin perder posiciones", () => {
    expect(diagnostico.coherente).toBe(false)
    expect(diagnostico.longitudes.precipitation).toBe(7)
    expect(registros).toHaveLength(8)
  })

  it("no convierte null, cadena vacía ni ausentes en cero", () => {
    expect(registros[1].temperatura_c).toBeNull()
    expect(registros[1].incidencias).toContain("temperatura_c: null")
    expect(registros[2].humedad_pct).toBeNull()
    expect(registros[2].incidencias).toContain("humedad_pct: cadena vacía")
    expect(registros[7].precipitacion_mm).toBeNull()
    expect(registros[7].incidencias).toContain("precipitacion_mm: ausente")
    expect(validos.some((v) => v.temperatura_c === 0)).toBe(false)
  })

  it("registra el motivo de cada rechazo", () => {
    expect(motivosDe(1)).toEqual(["Falta temperatura_c"])
    expect(motivosDe(2)).toEqual(["Falta humedad_pct"])
    expect(motivosDe(6)).toEqual(["humedad_pct fuera de rango 0–100 (105)"])
    expect(motivosDe(7)).toEqual([
      "Sin fecha_hora válida",
      "Falta precipitacion_mm",
    ])
  })

  it("elimina duplicados conservando la primera aparición", () => {
    expect(duplicados).toBe(1)
    expect(motivosDe(4)?.[0]).toMatch(
      /Duplicado.*primera aparición \(posición 3\)/
    )
    const t03 = validos.filter(
      (v) => v.fecha_hora === "2026-09-01T03:00:00.000Z"
    )
    expect(t03).toHaveLength(1)
    expect(t03[0].temperatura_c).toBe(13)
  })

  it("no descarta temperaturas extremas", () => {
    expect(validos.map((v) => v.temperatura_c)).toEqual([10, 13, -45.2])
    expect(rechazados).toHaveLength(5)
  })

  it("rechaza registros sin ciudad", () => {
    const sinCiudad = transformarCiudad("", realBarcelona as RespuestaOpenMeteo)
    const r = limpiar(sinCiudad.registros)
    expect(r.validos).toHaveLength(0)
    expect(r.rechazados[0].motivos).toEqual(["Sin ciudad"])
  })

  it("una precipitación negativa se rechaza", () => {
    const negativa = structuredClone(realBarcelona) as RespuestaOpenMeteo
    ;(negativa.hourly!.precipitation as number[])[0] = -0.1
    const r = limpiar(transformarCiudad("Barcelona", negativa).registros)
    expect(r.rechazados[0].motivos).toEqual([
      "precipitacion_mm negativa (-0.1)",
    ])
  })
})
