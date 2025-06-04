import { sql, type Kysely } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	// up migration code goes here...
	// note: up migrations are mandatory. you must implement this function.
	// For more info, see: https://kysely.dev/docs/migrations
	await db.schema
		.createTable('link')
    .addColumn('uuid', 'text', (col) => col.primaryKey().notNull())
		// source/origin/anchor of the link
		.addColumn('anchor', 'text', (col) => col.notNull())
		.addColumn('rel', 'text')
		// target href
		.addColumn('href', 'text', col => col.notNull())
		// as application/linkset+json https://www.rfc-editor.org/rfc/rfc9264.html#name-set-of-links-provided-as-app
		// this column can store more attributes for the target besides the href
		.addColumn('linkset', 'json')
		.addColumn('createdAt', 'timestamp',
			col => col
				.notNull()
				// this will work in sqlite3 but probably not postgres
				.defaultTo(sql`CURRENT_TIMESTAMP`)
		)
		.execute()
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	// down migration code goes here...
	// note: down migrations are optional. you can safely delete this function.
	// For more info, see: https://kysely.dev/docs/migrations
	await db.schema.dropTable('link').execute()
}
