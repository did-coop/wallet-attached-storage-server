import { NoResultError, PostgresIntrospector, sql, type Insertable, type QueryCreator, type Updateable } from "kysely"
import type { Database, DatabaseTables, IRepository, ISpace } from "./types"

export class SpaceNotFound extends Error { }

export default class SpaceRepository implements IRepository<ISpace> {
  static SpaceNotFound = SpaceNotFound
  #database: Database
  constructor(database: Database) {
    this.#database = database
  }
  /**
   * @throws {SpaceNotFound} if the space cannot be not found
   */
  async getById(id: string) {
    async function queryPostgresql(db: Database) {
      return await db.selectFrom('space')
        .leftJoin('link', 'link.anchor', sql`space.uuid::text` as any)
        .select([
          'space.uuid',
          'space.name',
          'space.controller',
          'link.href as link',
        ])
        .where(sql`space.uuid::text`, '=', id)
        .executeTakeFirstOrThrow()
    }
    async function querySqlite(db: Database) {
      return await db.selectFrom('space')
        .leftJoin('link', 'link.anchor', 'space.uuid')
        .select([
          'space.uuid',
          'space.name',
          'space.controller',
          'link.href as link',
        ])
        .where(`space.uuid`, '=', id)
        .executeTakeFirstOrThrow()      
    }
    try {
      const isPostgresql = this.#database.introspection instanceof PostgresIntrospector
      if (isPostgresql) {
        return await queryPostgresql(this.#database)
      } else {
        return await querySqlite(this.#database)
      }
    } catch (error) {
      if (error instanceof NoResultError) {
        throw new SpaceNotFound(`Space with id ${id} not found`, {
          cause: error,
        })
      }
      throw error
    }
    throw new SpaceNotFound(`Failed to get space with id ${id}`)
  }
  async create(space: Insertable<ISpace>) {
    try {
      const spaceRows = {
        controller: space.controller,
        uuid: space.uuid,
        name: space.name,
      }
      await this.#database.insertInto('space')
        .values(spaceRows)
        .executeTakeFirstOrThrow()
      if (space.link) {
        await this.#database.insertInto('link')
          .values({
            uuid: crypto.randomUUID(),
            anchor: space.uuid,
            rel: 'linkset',
            href: space.link,
          })
          .executeTakeFirstOrThrow()
      }
    } catch (error) {
      throw new Error(`Failed to create space`, {
        cause: error,
      })
    }
  }
  async deleteById(spaceId: string) {
    await this.#database.deleteFrom('space')
      .where('uuid', '=', spaceId)
      .executeTakeFirstOrThrow()
  }
  async put(space: Updateable<ISpace> & Pick<ISpace, 'uuid'>) {
    const rowForSpace = {
      controller: space.controller,
      uuid: space.uuid,
      name: space.name,
    }
    try {
      await this.#database.transaction().execute(async trx => {
        await trx.insertInto('space')
          .values(rowForSpace)
          .onConflict(oc => {
            return oc.column('uuid').doUpdateSet(rowForSpace)
          })
          .executeTakeFirstOrThrow()

        if (space.link) {
          await trx.deleteFrom('link')
            .where('link.anchor', '=', space.uuid)
            .where('link.rel', '=', 'linkset')
            .executeTakeFirstOrThrow()

          await trx.insertInto('link')
            .values({
              uuid: crypto.randomUUID(),
              anchor: space.uuid,
              rel: 'linkset',
              href: space.link,
            })
            .executeTakeFirstOrThrow()
        }
      })


    } catch (error) {
      throw new Error(`Failed to create space`, {
        cause: error,
      })
    }
  }
  async toArray() {
    const spaces = await this.#database.selectFrom('space')
      .leftJoin('link', 'link.anchor', 'space.uuid')
      .select([
        'space.uuid',
        'space.name',
        'space.controller',
        'link.href as link',
      ])
      .execute()
    return spaces
  }
}
