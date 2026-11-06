"use client"

import { Dialog } from "@base-ui/react/dialog"
import {
  ArrowUpIcon,
  LoaderCircleIcon,
  MessageCircleIcon,
  XIcon,
} from "lucide-react"
import Image from "next/image"
import * as React from "react"

import { Button } from "@/components/ui/button"

interface Mensaje {
  rol: "user" | "assistant"
  contenido: string
}

const MAX_CARACTERES_CONVERSACION = 16_000
const MAX_CARACTERES_MENSAJE = 2_000

export function ChatIa() {
  const [abierto, setAbierto] = React.useState(false)
  const [mensajes, setMensajes] = React.useState<Mensaje[]>([])
  const [entrada, setEntrada] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  const mensajesRef = React.useRef<HTMLDivElement>(null)
  const entradaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    mensajesRef.current?.scrollTo({
      top: mensajesRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [mensajes, enviando])

  async function enviarMensaje(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const contenido = entrada.trim()
    if (!contenido || enviando) return

    setEntrada("")
    setError(null)
    setEnviando(true)
    const historial = mensajes.slice(-19)
    while (
      historial.length > 0 &&
      historial.reduce(
        (total, mensaje) => total + mensaje.contenido.length,
        0,
      ) +
        contenido.length >
        MAX_CARACTERES_CONVERSACION
    ) {
      historial.shift()
    }
    const conversacion = [...historial, { rol: "user" as const, contenido }]

    try {
      const respuesta = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensajes: conversacion }),
      })
      const resultado: unknown = await respuesta.json()

      if (
        !respuesta.ok ||
        typeof resultado !== "object" ||
        resultado === null ||
        !("respuesta" in resultado) ||
        typeof resultado.respuesta !== "string"
      ) {
        const detalle =
          typeof resultado === "object" &&
          resultado !== null &&
          "error" in resultado &&
          typeof resultado.error === "string"
            ? resultado.error
            : "No se pudo obtener una respuesta."
        throw new Error(detalle)
      }

      setMensajes([
        ...conversacion,
        { rol: "assistant", contenido: resultado.respuesta },
      ])
      requestAnimationFrame(() => entradaRef.current?.focus())
    } catch (error) {
      setEntrada(contenido)
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo enviar el mensaje.",
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog.Root open={abierto} onOpenChange={setAbierto}>
      <Dialog.Trigger
        aria-label="Abrir chat con inteligencia artificial"
        className="absolute bottom-0 left-0 z-30 cursor-pointer rounded-tr-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Image
          src="/camaron.png"
          alt="Abrir chat con inteligencia artificial"
          width={761}
          height={1239}
          className="h-32 w-auto select-none object-contain sm:h-40"
        />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex h-[min(42rem,calc(100dvh-2rem))] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl outline-none">
          <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageCircleIcon aria-hidden className="size-5" />
              </span>
              <div>
                <Dialog.Title className="font-semibold">
                  Asistente IA
                </Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  Pregunta sobre datos, clima o el pipeline ETL.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close
              aria-label="Cerrar chat"
              className="rounded-md p-2 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <XIcon aria-hidden className="size-4" />
            </Dialog.Close>
          </header>

          <div
            ref={mensajesRef}
            aria-live="polite"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5"
          >
            {mensajes.length === 0 && (
              <p className="m-auto max-w-sm text-center text-sm text-muted-foreground">
                ¡Hola! Soy tu asistente. Escribe una pregunta para comenzar.
              </p>
            )}
            {mensajes.map((mensaje, indice) => (
              <div
                key={`${indice}-${mensaje.rol}`}
                className={
                  mensaje.rol === "user"
                    ? "ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                    : "mr-auto max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm"
                }
              >
                {mensaje.contenido}
              </div>
            ))}
            {enviando && (
              <div className="mr-auto flex items-center gap-2 rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
                Pensando…
              </div>
            )}
          </div>

          <form onSubmit={enviarMensaje} className="border-t p-4">
            {error && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={entradaRef}
                aria-label="Escribe tu mensaje"
                value={entrada}
                onChange={(evento) => setEntrada(evento.target.value)}
                onKeyDown={(evento) => {
                  if (evento.key === "Enter" && !evento.shiftKey) {
                    evento.preventDefault()
                    evento.currentTarget.form?.requestSubmit()
                  }
                }}
                maxLength={MAX_CARACTERES_MENSAJE}
                rows={2}
                placeholder="Escribe tu mensaje…"
                className="max-h-32 min-h-11 flex-1 resize-y rounded-xl border bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                disabled={enviando}
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Enviar mensaje"
                disabled={!entrada.trim() || enviando}
              >
                <ArrowUpIcon aria-hidden />
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Enter para enviar · Shift + Enter para nueva línea
            </p>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
