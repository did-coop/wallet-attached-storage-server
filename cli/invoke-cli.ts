import { parseArgs } from "node:util";
import type streamWeb from "node:stream/web"
import dedent from "dedent"
import WAS from 'wallet-attached-storage-server'
import { initializeDatabaseSchema } from 'wallet-attached-storage-database'
import { serve } from '@hono/node-server'
import type { Database } from 'wallet-attached-storage-database/types'
import { createDatabaseFromSqlite3Url, parseSqliteDatabaseUrl } from 'wallet-attached-storage-database/sqlite3'
import * as path from "path"
import {Kysely, SqliteDialect} from "kysely"
import Sqlite3Database from 'better-sqlite3'

/**
 * invoke the data.pub/cli command line interface
 * @param args - command line arguments
 * @returns descriptor of running cli process
 */
export async function invoke(args: string[], io?: {
  console?: typeof globalThis.console,
  stdin?: ReadableStream | streamWeb.ReadableStream
  stdout: WritableStream
  stderr: WritableStream
}, env = process.env): Promise<{ code: 0 | 1 }> {
  const console = io?.console ?? globalThis.console
  const stdout = io?.stdout || (new TransformStream).writable
  const stderr = io?.stderr || (new TransformStream).writable
  const stdin = io?.stdin
  const help = dedent`
  wallet-attached-storage-server

  Usage:
    wallet-attached-storage-server serve
  `
  const {
    values,
    positionals,
  } = parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: {
      verbose: {
        type: 'boolean',
        short: 'v',
        default: false,
      }
    },
  });

  const [command, ...commandPositionals] = positionals

  let showHelp = false
  let exitCode = 0
  switch (command) {
    case "help":
      showHelp = true
      break;
    case "serve":
      {
        // store data in-memory
        const data = createDatabaseFromEnv({
          DATABASE_URL: process.env.DATABASE_URL,
        })
        await initializeDatabaseSchema(data)

        const wasServer = new WAS.Server(data)
        const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 0
        const server = serve({
          fetch: wasServer.fetch,
          port
        }, (info) => {
          console.log(`Listening on http://localhost:${info.port}`)
        })
      }
      break;
    default:
      exitCode = 1
      showHelp = true
  }
  // unexpected command.
  // show usage.
  if (showHelp) {
    const stderrWriter = stderr.getWriter()
    await stderrWriter.write('\n')
    await stderrWriter.write(help)
    await stderrWriter.write('\n')
    stderrWriter.close()
  }
  // exit with code indicating error
  return {
    code: exitCode as 0 | 1,
  }
}

/**
 * given environment variables, create a suitable Database.
 * Use env.DATABASE_URL if provided, otherwise create an in-memory database.
 */
export function createDatabaseFromEnv(env: {
  DATABASE_URL?: unknown
}) {
  if (env.DATABASE_URL) {
    console.debug('creating database from DATABASE_URL')
    const database = createDatabaseFromSqlite3Url(env.DATABASE_URL?.toString())
    const parsedUrl = parseSqliteDatabaseUrl(env.DATABASE_URL?.toString())
    const relativeDatabasePath = path.relative(process.cwd(), parsedUrl.pathname)
    console.debug('database pathname is', relativeDatabasePath)
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
