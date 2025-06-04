import Database from 'better-sqlite3'
import { defineConfig, KyselyCTLConfig } from 'kysely-ctl'
import { fileURLToPath } from 'url'
import { Pool } from 'pg'

/**
 * Pattern to match DATABASE_URL environment variable value.
 * It has a named group for URL 'scheme' (e.g. 'postgresql:').
 */
const databaseUrlPattern = /^(?<scheme>[^:]+:).*/

/**
 * If not DATABASE_URL is set, use this default to sqlite3 with this database file.
 */
const defaultSqliteDatabaseUrl = new URL('../var/wallet-attached-storage-server.dev.sqlite3', import.meta.url)

/**
 * Get Kysely dialect configuratio based on DATABASE_URL environment variable.
 */
const kyselyConfigDialect = process.env.DATABASE_URL
	? getKyselyConfigForDatabaseUrl(process.env.DATABASE_URL)
	: createKyselySqliteConfig(defaultSqliteDatabaseUrl)

// Kysely configuration
export default defineConfig({
	...kyselyConfigDialect,
})

/**
 * Given a DATABASE_URL, return a Kysely config object with appropriate dialectConfig.
 */
function getKyselyConfigForDatabaseUrl(databaseUrl: string) {
	const match = databaseUrl.match(databaseUrlPattern)
	const scheme = match?.groups?.scheme
	switch (scheme) {
		case 'postgres:':
		case 'postgresql:': {
				const kyselyConfigPsql: Pick<KyselyCTLConfig<'pg'>, 'dialect'|'dialectConfig'> = {
				dialect: 'pg',
				dialectConfig: {
					pool: new Pool({
						connectionString: databaseUrl,
					}),
				},
			}
			return kyselyConfigPsql
		}
		case 'sqlite:':
		case 'sqlite3:': {
			return createKyselySqliteConfig(new URL(databaseUrl))
		}
		default:
			throw new Error(`Unsupported databaseUrl scheme: ${scheme}`)
	}
}

/**
 * return kysely configuration for sqlite using better-sqlite3
 */
function createKyselySqliteConfig(dbFileUrl: URL) {
	console.debug(`Creating Kysely config for sqlite3 database at ${dbFileUrl.toString()}`)
	const sqliteKyselyConfig: Pick<KyselyCTLConfig<'better-sqlite3'>, 'dialect'|'dialectConfig'> = {
		dialect: 'better-sqlite3',
		dialectConfig: {
			database: new Database(fileURLToPath(dbFileUrl)),
		}
	}
	return sqliteKyselyConfig 	
}
