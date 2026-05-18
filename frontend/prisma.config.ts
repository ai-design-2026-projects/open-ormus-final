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
    // DIRECT_URL (port 5432) is required for DDL operations — pgbouncer (DATABASE_URL)
    // does not support the prepared-statement protocol that Prisma migrate needs.
    // The app uses DATABASE_URL at runtime via lib/prisma.ts (driver adapter), independently.
    url: env("DIRECT_URL"),
  },
})
