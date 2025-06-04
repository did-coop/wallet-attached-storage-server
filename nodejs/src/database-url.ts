import { Kysely, PostgresDialect, SqliteDialect } from 'kysely'
import { Pool } from 'pg'
import BetterSqlite3Database from 'better-sqlite3'
import * as Cursor from 'pg-cursor'
import {ConnectionString} from 'connection-string';

export function createKyselyFromDatabaseUrl(databaseUrl: string): Kysely<any> {
  const match = databaseUrl.match(/^(?<scheme>[^:]+:).*/)
  const scheme = match?.groups?.scheme
  switch (scheme) {
    case 'postgres:':
    case 'postgresql:': {
      return new Kysely({
        dialect: new PostgresDialect({
          cursor: Cursor,
          pool: new Pool({
            connectionString: databaseUrl,
          }),
        }),
      })
    }
    case 'sqlite:':
    case 'sqlite3:': {
      const connectionString = new ConnectionString(databaseUrl)
      const dbFilePath = `/${connectionString.path?.join('/')}`
      return new Kysely({
        dialect: new SqliteDialect({
          database: new BetterSqlite3Database(dbFilePath),
        }),
      })
    }
    default:
      throw new Error(`Unsupported databaseUrl scheme: ${scheme}`)
  }
}
