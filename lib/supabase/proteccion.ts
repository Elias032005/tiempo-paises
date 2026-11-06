import "server-only"

/**
 * El proyecto no tiene autenticación. Para no dejar la escritura abierta por
 * accidente, los endpoints solo funcionan en desarrollo salvo que se active
 * ETL_PERMITIR_EN_PRODUCCION=true (y aun así habría que añadir autenticación).
 * Además se rechazan peticiones de escritura de otros orígenes.
 */
export function comprobarAcceso(
  request: Request,
  { escritura }: { escritura: boolean }
): Response | null {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ETL_PERMITIR_EN_PRODUCCION !== "true"
  ) {
    return Response.json(
      {
        error:
          "Endpoint deshabilitado en producción: añade autenticación antes de publicarlo.",
      },
      { status: 403 }
    )
  }

  if (escritura) {
    const origen = request.headers.get("origin")
    const host = request.headers.get("host")
    if (origen && host && new URL(origen).host !== host) {
      return Response.json({ error: "Origen no permitido." }, { status: 403 })
    }
  }
  return null
}
