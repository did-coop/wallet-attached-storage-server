import { Kysely, PostgresIntrospector, sql } from "kysely";

export async function initializeDatabaseSchema<Database>(db: Kysely<Database>) {
  await db.schema
    .createTable('space')
    .ifNotExists()
    .addColumn('uuid', 'uuid', (col) => col.primaryKey().notNull())
    .addColumn('name', 'text')
    .addColumn('controller', 'text')
    .execute()
  await db.schema
    .createTable('resource')
    .ifNotExists()
    .addColumn('uuid', 'uuid', (col) => col.primaryKey())
    .execute()

  const isPostgresql = db.introspection instanceof PostgresIntrospector
	const blobDataType = isPostgresql ? 'bytea' as const : 'blob' as const

  await db.schema
    .createTable('blob')
    .ifNotExists()
    .addColumn('uuid', 'text', (col) => col.primaryKey())
    .addColumn('type', 'text')
    .addColumn('bytes', blobDataType, col => col.notNull())
    .execute()
  await db.schema
    .createTable('resourceRepresentation')
    .ifNotExists()
    .addColumn('representationId', 'text')
    .addColumn('resourceId', 'uuid', (col) => col.references('resource.uuid'))
    .addColumn('createdAt', 'timestamp',
      col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute()
  await db.schema
    .createTable('spaceNamedResource')
    .ifNotExists()
    .addColumn('spaceId', 'uuid', col => col.notNull())
    .addColumn('name', 'text')
    .addColumn('resourceId', 'uuid', (col) => col.references('resource.uuid'))
    .execute()

  // Link
  await db.schema
    .createTable('link')
    .ifNotExists()
    .addColumn('uuid', 'text', (col) => col.primaryKey().notNull())
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
