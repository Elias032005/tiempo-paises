import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/** Ejecuta solo las pruebas contra Open-Meteo y Supabase reales. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/integracion.test.ts"],
    environment: "node",
    env: { INTEGRACION: "1" },
  },
})
