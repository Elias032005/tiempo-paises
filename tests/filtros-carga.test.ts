import { describe, expect, it, vi } from "vitest"

import {
  crearLotes,
  ejecutarLotes,
  resumirCarga,
  verificarClaves,
  type ClaveRegistro,
} from "@/lib/etl/carga"
import {
  aplicarFiltros,
  aRegistroCarga,
  calcularConjuntoCarga,
  FILTROS_INICIALES,
  interpretarFiltros,
  ordenar,
  paginar,
  resolverSeleccion,
  type Filtros,
} from "@/lib/etl/filtros"
import {
  claveDe,
  type RegistroCarga,
  type RegistroValido,
} from "@/lib/etl/tipos"

/** 2 ciudades × 60 horas, con valores deterministas. */
function generarValidos(): RegistroValido[] {
  const registros: RegistroValido[] = []
  for (const ciudad of ["Madrid", "Sevilla"]) {
    for (let h = 0; h < 60; h++) {
      const fecha_hora = new Date(Date.UTC(2026, 8, 1, h)).toISOString()
      registros.push({
        clave: claveDe(ciudad, fecha_hora),
        ciudad,
        fecha_hora,
        temperatura_c: ((h * 7 + (ciudad === "Madrid" ? 0 : 3)) % 40) - 5,
        humedad_pct: (h * 13) % 101,
        precipitacion_mm: h % 3 === 0 ? (h % 5) * 0.4 : 0,
      })
    }
  }
  return registros
}

const filtrar = (validos: RegistroValido[], f: Partial<Filtros>) =>
  aplicarFiltros(validos, interpretarFiltros({ ...FILTROS_INICIALES, ...f }))

describe("filtros y ordenación antes de paginar", () => {
  const validos = generarValidos()

  it("filtra y ordena el conjunto completo; la paginación solo recorta", () => {
    const filtrados = filtrar(validos, { soloLluvia: true })
    expect(filtrados.every((r) => r.precipitacion_mm > 0)).toBe(true)
    expect(filtrados.length).toBeGreaterThan(25)

    const ordenados = ordenar(filtrados, {
      campo: "temperatura_c",
      direccion: "desc",
    })
    const pagina1 = paginar(ordenados, 1, 25).filas
    const maximoGlobal = Math.max(...filtrados.map((r) => r.temperatura_c))
    expect(pagina1[0].temperatura_c).toBe(maximoGlobal)
    // La página 1 contiene los 25 mayores del conjunto filtrado, no de una página previa.
    const top25 = [...filtrados]
      .map((r) => r.temperatura_c)
      .sort((a, b) => b - a)
      .slice(0, 25)
    expect(pagina1.map((r) => r.temperatura_c)).toEqual(top25)
  })

  it("aplica ciudad, intervalo UTC (incluido) y rangos numéricos", () => {
    const r = filtrar(validos, {
      ciudades: ["Sevilla"],
      desde: "2026-09-01T10:00",
      hasta: "2026-09-01T20:00",
      humedadMin: "20",
      humedadMax: "80",
      temperaturaMin: "-5",
      precipitacionMax: "0,5",
    })
    expect(r.length).toBeGreaterThan(0)
    for (const x of r) {
      expect(x.ciudad).toBe("Sevilla")
      expect(x.fecha_hora >= "2026-09-01T10:00:00.000Z").toBe(true)
      expect(x.fecha_hora <= "2026-09-01T20:00:00.000Z").toBe(true)
      expect(x.humedad_pct).toBeGreaterThanOrEqual(20)
      expect(x.humedad_pct).toBeLessThanOrEqual(80)
      expect(x.precipitacion_mm).toBeLessThanOrEqual(0.5)
    }
    const extremos = filtrar(validos, {
      ciudades: ["Sevilla"],
      desde: "2026-09-01T10:00",
      hasta: "2026-09-01T10:00",
    })
    expect(extremos.map((x) => x.fecha_hora)).toEqual([
      "2026-09-01T10:00:00.000Z",
    ])
  })

  it("informa de límites no válidos y de mínimos mayores que máximos", () => {
    const f = interpretarFiltros({
      ...FILTROS_INICIALES,
      temperaturaMin: "abc",
      humedadMin: "90",
      humedadMax: "10",
    })
    expect(f.errores).toEqual([
      "Temperatura: el mínimo no es un número.",
      "Humedad: el mínimo es mayor que el máximo.",
    ])
  })

  it("el orden es determinista (desempate por ciudad y fecha)", () => {
    const a = ordenar(validos, { campo: "precipitacion_mm", direccion: "asc" })
    const b = ordenar([...validos].reverse(), {
      campo: "precipitacion_mm",
      direccion: "asc",
    })
    expect(a.map((r) => r.clave)).toEqual(b.map((r) => r.clave))
  })
})

describe("modo de selección", () => {
  const validos = generarValidos()
  const orden = { campo: "fecha_hora", direccion: "asc" } as const
  const vacia = new Set<string>()

  it("automático: se selecciona todo lo filtrado y sigue a los filtros", () => {
    const madrid = ordenar(filtrar(validos, { ciudades: ["Madrid"] }), orden)
    const c1 = calcularConjuntoCarga(
      madrid,
      resolverSeleccion("automatico", vacia, madrid)
    )
    expect(c1.registros).toEqual(madrid)

    const todos = ordenar(validos, orden)
    const c2 = calcularConjuntoCarga(
      todos,
      resolverSeleccion("automatico", vacia, todos)
    )
    expect(c2.registros).toHaveLength(120)
    expect(c2.seleccionadosFueraDeFiltro).toBe(0)
  })

  it("manual: usa la selección guardada e ignora el conjunto filtrado", () => {
    const todos = ordenar(validos, orden)
    const manual = new Set([todos[3].clave])
    expect(resolverSeleccion("manual", manual, todos)).toBe(manual)
  })
})

describe("selección entre varias páginas", () => {
  const validos = generarValidos()
  const orden = { campo: "fecha_hora", direccion: "asc" } as const

  it("«seleccionar todas» incluye filas de todas las páginas filtradas", () => {
    const filtrados = ordenar(filtrar(validos, { ciudades: ["Madrid"] }), orden)
    expect(paginar(filtrados, 1, 25).totalPaginas).toBe(3)
    const seleccion = new Set(filtrados.map((r) => r.clave))
    const conjunto = calcularConjuntoCarga(filtrados, seleccion)
    expect(conjunto.registros).toHaveLength(60)
    expect(conjunto.seleccionadosFueraDeFiltro).toBe(0)
  })

  it("selección manual en páginas 1 y 3 se conserva al paginar", () => {
    const ordenados = ordenar(validos, orden)
    const p1 = paginar(ordenados, 1, 25).filas
    const p3 = paginar(ordenados, 3, 25).filas
    const seleccion = new Set([p1[0].clave, p1[5].clave, p3[2].clave])
    const conjunto = calcularConjuntoCarga(ordenados, seleccion)
    expect(conjunto.registros.map((r) => r.clave)).toEqual([
      p1[0].clave,
      p1[5].clave,
      p3[2].clave,
    ])
  })

  it("al cambiar filtros no se seleccionan filas nuevas y se cuentan las que quedan fuera", () => {
    const soloMadrid = ordenar(
      filtrar(validos, { ciudades: ["Madrid"] }),
      orden
    )
    const seleccion = new Set(soloMadrid.slice(0, 10).map((r) => r.clave))

    const ampliado = ordenar(validos, orden)
    const c1 = calcularConjuntoCarga(ampliado, seleccion)
    expect(c1.registros).toHaveLength(10) // no aparecen filas de Sevilla

    const restringido = ordenar(
      filtrar(validos, { ciudades: ["Madrid"], hasta: "2026-09-01T04:00" }),
      orden
    )
    const c2 = calcularConjuntoCarga(restringido, seleccion)
    expect(c2.registros).toHaveLength(5)
    expect(c2.seleccionadosFueraDeFiltro).toBe(5)
  })
})

describe("carga por lotes", () => {
  const validos = generarValidos()

  function conjuntoGrande(n: number): RegistroCarga[] {
    return Array.from({ length: n }, (_, i) => ({
      ciudad: i % 2 ? "Madrid" : "Bilbao",
      fecha_hora: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(),
      temperatura_c: i,
      humedad_pct: 50,
      precipitacion_mm: 0,
    }))
  }

  it("divide en lotes de 500 como máximo y congela la copia", () => {
    const origen = conjuntoGrande(1201)
    const lotes = crearLotes(origen)
    expect(lotes.map((l) => l.registros.length)).toEqual([500, 500, 201])
    origen[0].temperatura_c = 999
    origen.push(origen[1])
    expect(lotes[0].registros[0].temperatura_c).toBe(0)
    expect(lotes.flatMap((l) => l.registros)).toHaveLength(1201)
    expect(Object.isFrozen(lotes[0].registros[0])).toBe(true)
  })

  it("la vista previa coincide exactamente (filas y orden) con lo enviado", async () => {
    const ordenados = ordenar(validos, {
      campo: "temperatura_c",
      direccion: "desc",
    })
    const seleccion = new Set(
      ordenados.filter((_, i) => i % 3 === 0).map((r) => r.clave)
    )
    const vistaPrevia = calcularConjuntoCarga(ordenados, seleccion).registros
    const enviados: RegistroCarga[] = []
    await ejecutarLotes(
      crearLotes(vistaPrevia.map(aRegistroCarga), 7),
      async (lote) => {
        enviados.push(...lote)
        return { procesados: lote.length }
      }
    )
    expect(enviados).toEqual(vistaPrevia.map(aRegistroCarga))
  })

  it("un fallo parcial conserva los lotes correctos y el reintento solo envía los fallidos", async () => {
    const lotes = crearLotes(conjuntoGrande(1201))
    const enviar = vi.fn(async (registros: readonly RegistroCarga[]) => {
      if (registros === lotes[1].registros && enviar.mock.calls.length <= 3) {
        throw new Error("Error de red simulado")
      }
      return { procesados: registros.length }
    })

    const tras1 = await ejecutarLotes(lotes, enviar)
    expect(tras1.map((l) => l.estado)).toEqual([
      "completado",
      "error",
      "completado",
    ])
    expect(resumirCarga(tras1)).toMatchObject({
      completados: 701,
      fallidos: 500,
      lotesFallidos: 1,
    })
    expect(tras1[1].error).toBe("Error de red simulado")

    const tras2 = await ejecutarLotes(tras1, enviar)
    expect(enviar).toHaveBeenCalledTimes(4)
    expect(enviar.mock.calls[3][0]).toBe(lotes[1].registros)
    expect(tras2.map((l) => l.estado)).toEqual([
      "completado",
      "completado",
      "completado",
    ])
    expect(tras2.map((l) => l.intentos)).toEqual([1, 2, 1])
    expect(resumirCarga(tras2).completados).toBe(1201)
  })

  it("verifica las claves por lotes y normaliza el formato de Postgres", async () => {
    const claves: ClaveRegistro[] = conjuntoGrande(1100).map((r) => ({
      ciudad: r.ciudad,
      fecha_hora: r.fecha_hora,
    }))
    const tamanosConsulta: number[] = []
    const resultado = await verificarClaves(claves, async (lote) => {
      tamanosConsulta.push(lote.length)
      // Postgres devuelve "2026-09-01T00:00:00+00:00"; falta la última clave.
      return lote
        .filter((c) => c !== claves[claves.length - 1])
        .map((c) => ({
          ciudad: c.ciudad,
          fecha_hora: c.fecha_hora.replace(".000Z", "+00:00"),
        }))
    })
    expect(tamanosConsulta).toEqual([500, 500, 100])
    expect(resultado.encontradas).toBe(1099)
    expect(resultado.faltantes).toEqual([claves[claves.length - 1]])
  })
})
