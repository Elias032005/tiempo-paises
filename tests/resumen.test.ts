import { describe, expect, it } from "vitest"

import {
  distribucionPorRangos,
  escalaEje,
  motivosFrecuentes,
  resumirPorCiudad,
  seriesPorDia,
} from "@/lib/etl/resumen"
import type { RegistroRechazado, RegistroValido } from "@/lib/etl/tipos"

function valido(
  ciudad: string,
  hora: number,
  temperatura_c: number,
  precipitacion_mm = 0
): RegistroValido {
  const fecha_hora = `2026-09-01T${String(hora).padStart(2, "0")}:00:00Z`
  return {
    clave: `${ciudad}|${fecha_hora}`,
    ciudad,
    fecha_hora,
    temperatura_c,
    humedad_pct: 50,
    precipitacion_mm,
  }
}

describe("resumirPorCiudad", () => {
  const validos = [
    valido("Madrid", 0, 10, 1),
    valido("Madrid", 1, 20, 2),
    valido("Bilbao", 0, 15, 4),
  ]

  it("calcula la media por ciudad y la media global de todas las horas", () => {
    const r = resumirPorCiudad(validos, "temperatura")
    expect(r.ciudades).toEqual([
      { ciudad: "Madrid", valor: 15, registros: 2 },
      { ciudad: "Bilbao", valor: 15, registros: 1 },
    ])
    expect(r.global).toBe(15)
  })

  it("suma la precipitación en lugar de promediarla", () => {
    const r = resumirPorCiudad(validos, "precipitacion")
    expect(r.ciudades.map((c) => c.valor)).toEqual([3, 4])
    expect(r.global).toBe(7)
  })

  it("devuelve un resumen vacío sin registros", () => {
    expect(resumirPorCiudad([], "temperatura")).toEqual({
      ciudades: [],
      global: 0,
    })
  })
})

describe("seriesPorDia", () => {
  it("agrupa por ciudad y día y deja null los días sin datos", () => {
    const otroDia = {
      ...valido("Bilbao", 3, 30),
      fecha_hora: "2026-09-02T03:00:00Z",
    }
    const r = seriesPorDia(
      [valido("Madrid", 0, 10), valido("Madrid", 1, 20), otroDia],
      "temperatura"
    )
    expect(r.dias).toEqual(["2026-09-01", "2026-09-02"])
    expect(r.series).toEqual([
      { ciudad: "Madrid", valores: [15, null] },
      { ciudad: "Bilbao", valores: [null, 30] },
    ])
  })

  it("suma la precipitación del día", () => {
    const r = seriesPorDia(
      [valido("Madrid", 0, 10, 1.5), valido("Madrid", 1, 10, 2)],
      "precipitacion"
    )
    expect(r.series[0].valores).toEqual([3.5])
  })
})

describe("distribucionPorRangos", () => {
  it("reparte las horas por rango con límites superiores exclusivos", () => {
    const r = distribucionPorRangos(
      [9.9, 10, 25, 30, 41].map((t, i) => valido("Madrid", i, t)),
      "temperatura"
    )
    expect(r.map((x) => x.horas)).toEqual([1, 1, 1, 2])
  })

  it("cuenta como «sin lluvia» las horas con 0 mm", () => {
    const r = distribucionPorRangos(
      [0, 0, 0.5, 6].map((p, i) => valido("Madrid", i, 20, p)),
      "precipitacion"
    )
    expect(r).toEqual([
      { etiqueta: "Sin lluvia", horas: 2 },
      { etiqueta: "0,1–1 mm", horas: 1 },
      { etiqueta: "1–4 mm", horas: 0 },
      { etiqueta: "≥ 4 mm", horas: 1 },
    ])
  })
})

describe("escalaEje", () => {
  it("redondea hacia arriba e incluye el cero", () => {
    expect(escalaEje([18.4, 23.1])).toEqual({
      min: 0,
      max: 30,
      marcas: [0, 10, 20, 30],
    })
  })

  it("admite valores negativos", () => {
    const e = escalaEje([-3, 12])
    expect(e.min).toBeLessThanOrEqual(-3)
    expect(e.max).toBeGreaterThanOrEqual(12)
    expect(e.marcas).toContain(0)
  })

  it("no divide por cero si todo vale 0", () => {
    expect(escalaEje([0, 0])).toEqual({ min: 0, max: 1, marcas: [0, 1] })
  })
})

describe("motivosFrecuentes", () => {
  const rechazado = (motivos: string[]) =>
    ({ registro: {}, motivos }) as unknown as RegistroRechazado

  it("agrupa motivos que solo se diferencian en el valor concreto", () => {
    const r = motivosFrecuentes([
      rechazado(["humedad_pct fuera de rango 0–100 (105)"]),
      rechazado([
        "humedad_pct fuera de rango 0–100 (-2)",
        "Falta temperatura_c",
      ]),
      rechazado([
        "Duplicado de ciudad + fecha_hora: se conserva la primera aparición (posición 3)",
      ]),
    ])
    expect(r).toEqual([
      { motivo: "humedad_pct fuera de rango 0–100", total: 2 },
      { motivo: "Duplicado de ciudad + fecha_hora", total: 1 },
      { motivo: "Falta temperatura_c", total: 1 },
    ])
  })
})
