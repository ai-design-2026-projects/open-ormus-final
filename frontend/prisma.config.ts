import { defineConfig, env } from "prisma/config"

// prisma.config.ts is evaluated before Prisma loads .env files,
// so we load it explicitly using Node 20's built-in API
try { process.loadEnvFile(".env.local") } catch { /* file not present */ }
try { process.loadEnvFile(".env") } catch { /* file not present */ }

export default defineConfig({
  schema: "../prisma/schema.prisma",
  migrations: {
    path: "../prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
})
