import { Kysely, SqliteDialect } from 'kysely'
import { serve } from '@hono/node-server'
import Sqlite3Database from 'better-sqlite3'
import type { Database } from 'wallet-attached-storage-database/types'
import { createDatabaseFromSqlite3Url } from 'wallet-attached-storage-database/sqlite3'
import WAS from 'wallet-attached-storage-server'
import { initializeDatabaseSchema } from '../../database/src/schema.ts'
import { parseSqliteDatabaseUrl } from '../../database/src/sqlite3/database-url-sqlite3.ts'
import * as path from 'node:path'
import { createKyselyFromDatabaseUrl } from '../src/database-url.ts'

// store data in-memory
const data = createDatabaseFromEnv({
  DATABASE_URL: process.env.DATABASE_URL,
})
await initializeDatabaseSchema(data)

const { fetch } = new WAS.Server(data, {
  cors: {
    origin(origin: string | undefined) {
      if (process.env.CORS_ALLOW_ALL_ORIGINS) {
        return origin ?? null
      }
      const allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS
      if (allowedOriginsEnv) {
        const allowedOrigins = JSON.parse(allowedOriginsEnv)
        if (allowedOrigins.includes(origin)) {
          return origin ?? null
        } else {
          console.warn('origin is not in CORS_ALLOWED_ORIGINS', origin)
        }
      }
      return null
    }
  },
  trustHeaderXForwardedProto: Boolean(process.env.TRUST_HEADER_X_FORWARDED_PROTO),
})
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 0
const server = serve({
  fetch,
  port
}, (info) => {
  console.log(`Listening on http://localhost:${info.port}`)
})

/**
 * given environment variables, create a suitable Database.
 * Use env.DATABASE_URL if provided, otherwise create an in-memory database.
 */
function createDatabaseFromEnv(env: {
  DATABASE_URL?: unknown
}) {
  if (env.DATABASE_URL) {
    console.debug('creating database from DATABASE_URL')
    const database = createKyselyFromDatabaseUrl(env.DATABASE_URL?.toString())
    console.debug('database from DATABASE_URL', database)
    if (database) {
      return database
    }
  }
  // if no DATABASE_URL is provided, create an in-memory database
  const inMemoryDatabase = createInMemoryDatabase()
  console.debug('using in-memory database')
  return inMemoryDatabase
}

function createInMemoryDatabase() {
  const data: Database = new Kysely({
    dialect: new SqliteDialect({
      async database() {
        return new Sqlite3Database(':memory:')
      }
    })
  })
  return data
}
