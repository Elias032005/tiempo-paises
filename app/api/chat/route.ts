interface MensajeEntrada {
  role: "user" | "assistant"
  content: string
}

const MAX_MENSAJES = 20
const MAX_CARACTERES_POR_MENSAJE = 2000
const MAX_CARACTERES_TOTALES = 16000
const MAX_BYTES_PETICION = 64 * 1024
const MAX_TOKENS_RESPUESTA = 500

const INSTRUCCIONES_AGENTE = `Eres el asistente de una aplicación educativa en español para un pipeline ETL de datos meteorológicos con Open-Meteo y Supabase.

Comportamiento:
- Responde en español, de forma amable, clara y concisa. Usa pasos numerados cuando ayuden.
- Ayuda con el uso de la aplicación, extracción, transformación, validación, filtros, carga, lectura de datos y conceptos generales de meteorología y ETL.
- Si no entiendes una pregunta o faltan datos, pide una aclaración concreta en vez de adivinar.
- Distingue entre instrucciones generales y el estado real de la aplicación. No puedes inspeccionar el mapa, el navegador, Supabase, Vercel ni el pipeline a menos que esos datos se incluyan explícitamente en la conversación.
- No afirmes que has ejecutado acciones, consultado servicios, visto registros o cambiado configuraciones.
- Si te preguntan por resultados o datos concretos que no se han proporcionado, explica esa limitación y di cómo consultarlos en la aplicación.
- No solicites ni reveles contraseñas, claves API, tokens, variables de entorno ni otros secretos. Recuerda que las claves deben configurarse en el servidor y no compartirse por chat.
- No ayudes a eludir controles de acceso, límites de uso o medidas de seguridad.
- Mantén cada respuesta breve y centrada en la pregunta. Si la petición excede tu alcance, dilo con claridad y ofrece una alternativa relacionada con la aplicación.`

function validarMensajes(valor: unknown): MensajeEntrada[] | null {
  if (
    !Array.isArray(valor) ||
    valor.length === 0 ||
    valor.length > MAX_MENSAJES
  )
    return null

  const mensajes: MensajeEntrada[] = []
  let totalCaracteres = 0

  for (const mensaje of valor) {
    if (
      typeof mensaje !== "object" ||
      mensaje === null ||
      !("role" in mensaje) ||
      !("content" in mensaje) ||
      (mensaje.role !== "user" && mensaje.role !== "assistant") ||
      typeof mensaje.content !== "string" ||
      mensaje.content.trim().length === 0 ||
      mensaje.content.length > MAX_CARACTERES_POR_MENSAJE
    ) {
      return null
    }

    totalCaracteres += mensaje.content.length
    if (totalCaracteres > MAX_CARACTERES_TOTALES) return null

    mensajes.push({ role: mensaje.role, content: mensaje.content.trim() })
  }

  if (mensajes.at(-1)?.role !== "user") return null
  return mensajes
}

export async function POST(request: Request) {
  const clave = process.env.OPENAI_API_KEY
  if (!clave) {
    return Response.json(
      { error: "Falta configurar OPENAI_API_KEY en el servidor." },
      { status: 503 },
    )
  }

  const longitud = Number(request.headers.get("content-length"))
  if (Number.isFinite(longitud) && longitud > MAX_BYTES_PETICION) {
    return Response.json(
      { error: "La petición supera el tamaño máximo permitido." },
      { status: 413 },
    )
  }

  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return Response.json(
      { error: "El cuerpo debe ser JSON válido." },
      { status: 400 },
    )
  }

  if (
    typeof cuerpo !== "object" ||
    cuerpo === null ||
    !("mensajes" in cuerpo)
  ) {
    return Response.json(
      { error: "El formato de la conversación no es válido." },
      { status: 400 },
    )
  }

  const mensajes = validarMensajes(cuerpo.mensajes)
  if (!mensajes) {
    return Response.json(
      {
        error: "La conversación no es válida o supera los límites permitidos.",
      },
      { status: 400 },
    )
  }

  let respuesta: Response
  try {
    respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clave}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: INSTRUCCIONES_AGENTE,
          },
          ...mensajes,
        ],
        max_completion_tokens: MAX_TOKENS_RESPUESTA,
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    console.error(
      "[chat] No se pudo contactar con OpenAI:",
      error instanceof Error ? error.message : "Error desconocido",
    )
    return Response.json(
      {
        error:
          "No se pudo contactar con el servicio de inteligencia artificial.",
      },
      { status: 502 },
    )
  }

  if (!respuesta.ok) {
    console.error(`[chat] OpenAI respondió con HTTP ${respuesta.status}.`)
    const mensaje =
      respuesta.status === 401
        ? "La clave de OpenAI no es válida. Revisa OPENAI_API_KEY en el servidor."
        : respuesta.status === 429
          ? "Se alcanzó un límite de uso de OpenAI. Inténtalo más tarde."
          : `OpenAI no pudo responder (HTTP ${respuesta.status}).`
    return Response.json({ error: mensaje }, { status: 502 })
  }

  const resultado: unknown = await respuesta.json()
  if (
    typeof resultado !== "object" ||
    resultado === null ||
    !("choices" in resultado) ||
    !Array.isArray(resultado.choices)
  ) {
    console.error(
      "[chat] OpenAI devolvió una respuesta con formato inesperado.",
    )
    return Response.json(
      {
        error:
          "El servicio de inteligencia artificial devolvió una respuesta no válida.",
      },
      { status: 502 },
    )
  }

  const contenido = resultado.choices[0]?.message?.content
  if (typeof contenido !== "string" || !contenido.trim()) {
    return Response.json(
      { error: "El servicio de inteligencia artificial no devolvió texto." },
      { status: 502 },
    )
  }

  return Response.json({ respuesta: contenido.trim() })
}
