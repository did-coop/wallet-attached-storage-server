import { Kysely, PostgresIntrospector, sql, SqliteIntrospector, type Insertable, type QueryCreator } from "kysely"
import type { Database, DatabaseTables, IRepository, IResource } from "./types"
import { map } from "streaming-iterables"

export default class ResourceRepository implements IRepository<IResource> {
  #database: QueryCreator<DatabaseTables> & { introspection?: Database['introspection'] }
  constructor(database: QueryCreator<DatabaseTables> & { introspection?: Database['introspection'] }) {
    this.#database = database
  }
  async getById(id: string) {
    const result = await this.#database.selectFrom('resource')
      .selectAll()
      .where('uuid', '=', id)
      .executeTakeFirstOrThrow()
    return result
  }
  async getBySpaceName(space: string, name: string) {
    const result = await this.#database.selectFrom('spaceNamedResource')
      // .innerJoin('resource', 'spaceNamedResource.resourceId', 'resource.uuid')
      .where('spaceId', '=', space)
      .where('name', '=', name)
      .selectAll()
      .executeTakeFirstOrThrow()
    const namedResource = {
      uuid: result.resourceId,
      name: {
        space: result.spaceId,
        name: result.name,
      },
    }
    return namedResource
  }

  async * iterateSpaceNamedRepresentations(query: {
    space: string,
    name?: string,
  }) {
    const resultOfSelectRepresentations = await this.#database.selectFrom('resourceRepresentation')
      .innerJoin('spaceNamedResource', 'spaceNamedResource.resourceId', 'resourceRepresentation.resourceId')
      .innerJoin('blob', 'blob.uuid', 'resourceRepresentation.representationId')
      .select([
        'blob.bytes',
        'blob.type',
        'resourceRepresentation.createdAt',
        'spaceNamedResource.name',
        'spaceNamedResource.spaceId as space',
      ])
      .where('spaceNamedResource.spaceId', '=', query.space)
      .$if(typeof query.name === 'string', qb => qb.where('spaceNamedResource.name', '=', query.name as string))
      .orderBy('resourceRepresentation.createdAt', 'desc')
      .execute()
    yield* map(
      x => ({
        blob: new File([x.bytes], x.name, { type: x.type }),
        createdAt: x.createdAt,
      }),
      resultOfSelectRepresentations)
  }

  /**
   * iterate items that are descendants of a collection in the space.
   * @param query
   * @param query.space - uuid of space
   * @param query.collection - name of collection in that space. must end in '/'.
   */
  async * iterateSpaceCollectionDescendants(query: {
    /** space uuid */
    space: string,
    /** collection name within space. */
    collection?: string,
  }) {
    const collection = query.collection ?? ''
    if (collection && !collection.endsWith('/')) {
      throw new Error(`collection name MUST end with /`, { cause: { collection } })
    }
    const resultOfSelectResources = await this.#database.selectFrom('spaceNamedResource')
      .innerJoin('resourceRepresentation', 'spaceNamedResource.resourceId', 'resourceRepresentation.resourceId')
      .innerJoin('blob', 'resourceRepresentation.representationId', 'blob.uuid')
      .select([
        'spaceNamedResource.name',
        'spaceNamedResource.spaceId as space',
        // Get all distinct media types as comma-separated string
        sql<string>`group_concat(distinct blob.type)`.as('mediaTypesStr')
      ])
      .where('spaceNamedResource.spaceId', '=', query.space)
      .where('spaceNamedResource.name', 'like', `${collection}%`)
      // exclude collection itself
      .where('spaceNamedResource.name', '!=', collection)
      .groupBy(['spaceNamedResource.name'])
      .stream()
    yield* map(
      x => ({
        name: x.name,
        representation: x.mediaTypesStr.split(',').map(mediaType => ({
          mediaType,
        }))
      }),
      resultOfSelectResources
    );
  }

  /**
   * get direct members of a collection in a space.
   * There are some not-so-obvious parts of this.
   * 
   * Given a space has only a/b/c,
   * When we iterateSpaceCollectionMembers w/ collection a/
   * Then the result set includes a/b/
   * i.e. a/b/ implicitly exists because a/b/c does.
   * 
   * Given a space with a/b/, a/b/c
   * When we iterateSpaceCollectionMembers w/ collection a/
   * Then the result set is a/b/
   * i.e. only iterate direct children, not deep descendants like a/b/c

   * @param query 
   */
  async * iterateSpaceCollectionMembers(query: {
    /** space uuid */
    space: string,
    /** collection name within space */
    collection?: string,
  }) {
    const introspectionName = this.#database.introspection?.constructor.name
    switch (introspectionName) {
      case 'PostgresIntrospector':
        yield* this.iterateSpaceCollectionMembersPostgresql(query)
        break;
      default:
        yield* this.iterateSpaceCollectionMembersSqlite3(query)
        break;
    }
  }

  // iterateSpaceCollectionMembers for postgresql
  async * iterateSpaceCollectionMembersPostgresql(
    query: Parameters<ResourceRepository['iterateSpaceCollectionMembers']>[0]
  ) {
    yield* iterateSpaceCollectionMembersPostgresql(this.#database, query)
  }

  // iterateSpaceCollectionMembers for sqlite3
  async * iterateSpaceCollectionMembersSqlite3(
    query: Parameters<ResourceRepository['iterateSpaceCollectionMembers']>[0]
  ) {
    yield* iterateSpaceCollectionMembersSqlite3(this.#database, query)
  }

  async create(input: Insertable<IResource> & { representation?: Blob }) {
    try {
      await this.#database.insertInto('resource')
        .values({
          ...input,
        })
        .executeTakeFirstOrThrow()
    } catch (error) {
      throw new Error(`Failed to create`, {
        cause: error,
      })
    }
  }
  async deleteById(id: string) {
    function isUrnUuidUri(uri: string): uri is `urn:uuid:${string}${string}` {
      if (!uri.startsWith('urn:uuid:')) return false
      return true
    }
    if (isUrnUuidUri(id)) {
      const parsed = parseUrnUuidUriToSpaceName(id)
      const resultOfDelete = await this.#database.deleteFrom('spaceNamedResource')
        .where('spaceNamedResource.spaceId', '=', parsed.uuid)
        .where('spaceNamedResource.name', '=', parsed.name)
        .executeTakeFirstOrThrow()
      if (resultOfDelete.numDeletedRows) {
        return true
      } else if (resultOfDelete.numDeletedRows === 0n) {
        return false
      }
      return
    }
    throw new Error(`Unable to parse id to deleteById`, { cause: { id } })
  }
  /**
   * @param input
   * @param input.space - The space UUID
   */
  async putSpaceNamedResource(input: {
    space: string,
    name: string,
    representation: Blob,
  }) {
    const blobToInsert = {
      uuid: crypto.randomUUID(),
      type: input.representation.type,
      bytes: await input.representation.bytes(),
    }
    // insert blob
    await this.#database.insertInto('blob')
      .values(blobToInsert)
      .executeTakeFirstOrThrow()

    // insert resource
    const resourceToInsert = {
      uuid: crypto.randomUUID()
    }
    await this.#database.insertInto('resource')
      .values(resourceToInsert)
      .executeTakeFirstOrThrow()

    // insert resource representation
    await this.#database.insertInto('resourceRepresentation')
      .values({
        resourceId: resourceToInsert.uuid,
        representationId: blobToInsert.uuid,
      })
      .executeTakeFirstOrThrow()

    // bind space name to resource
    await this.#database.insertInto('spaceNamedResource')
      .values({
        spaceId: input.space,
        name: input.name,
        resourceId: resourceToInsert.uuid,
      })
      .executeTakeFirstOrThrow()
  }
  async toArray() {
    const spaces = await this.#database.selectFrom('resource').selectAll().execute()
    return spaces
  }
}

function parseUrnUuidUriToSpaceName(uri: `urn:uuid:${string}${string}`) {
  const pattern = /urn:uuid:(?<uuid>[^/]+)(?<path>\/(?<name>.*))/
  const match = uri.match(pattern)
  if (match && match.groups) {
    const { uuid, path, name } = match.groups
    if (uuid && path) {
      return {
        space: uuid,
        uuid,
        path,
        name,
      }
    }
  }
  throw new Error(`Failed to parse URN UUID URI: ${uri}`)
}

/**
 * ResourceRepository#iterateSpaceCollectionMembers but can assume database is sqlite
 * @param query 
 */
async function* iterateSpaceCollectionMembersSqlite3(database: QueryCreator<DatabaseTables>, query: {
  /** space uuid */
  space: string,
  /** collection name within space */
  collection?: string,
}) {
  const collection = query.collection ?? ''
  if (collection && !collection.endsWith('/')) {
    throw new Error(`collection name MUST end with /`, { cause: { collection } })
  }
  const resultOfSelectResources = await database
    .with('all_members', (qb) => {
      return qb
        .selectFrom('spaceNamedResource')
        .select([
          sql<string>`
          CASE 
            WHEN SUBSTR(name, ${collection.length + 1}) LIKE '%/%' 
            AND name NOT LIKE '%/' THEN
              ${collection} || SUBSTR(name, ${collection.length + 1}, INSTR(SUBSTR(name, ${collection.length + 1}), '/'))
            ELSE
              name
          END
        `.as('name'),
          sql<string | null>`
          CASE 
            WHEN SUBSTR(name, ${collection.length + 1}) LIKE '%/%' 
            AND name NOT LIKE '%/' THEN
              NULL
            ELSE
              resourceId
          END
        `.as('resourceId'),
          sql<boolean>`
          CASE 
            WHEN SUBSTR(name, ${collection.length + 1}) LIKE '%/%' 
            AND name NOT LIKE '%/' THEN
              TRUE
            ELSE
              name LIKE '%/'
          END
        `.as('isCollection'),
          'spaceId'
        ])
        .where('spaceId', '=', query.space)
        .where('name', 'is not', null)
        .where('name', 'like', collection + '%')
        .$if(!!collection, (qb) => qb.where('name', '!=', collection));
    })
    .selectFrom('all_members')
    .leftJoin('resourceRepresentation', 'all_members.resourceId', 'resourceRepresentation.resourceId')
    .leftJoin('blob', 'resourceRepresentation.representationId', 'blob.uuid')
    .select([
      'all_members.name',
      'all_members.spaceId as space',
      'all_members.resourceId',
      'all_members.isCollection',
      sql<string | null>`group_concat(distinct blob.type)`.as('mediaTypesStr')
    ])
    .groupBy(['all_members.name', 'all_members.spaceId'])
    .orderBy('all_members.name')
    .stream();
  yield* map(
    x => ({
      name: x.name,
      representation: x.mediaTypesStr?.split(',').map(mediaType => ({
        mediaType,
      }))
    }),
    resultOfSelectResources
  );
}

/**
 * ResourceRepository#iterateSpaceCollectionMembers but can assume database is postgresql
 * @param query 
 */
async function* iterateSpaceCollectionMembersPostgresql(database: QueryCreator<DatabaseTables>, query: {
  /** space uuid */
  space: string,
  /** collection name within space */
  collection?: string,
}) {
  const collection = query.collection ?? '';
  if (collection && !collection.endsWith('/')) {
    throw new Error(`collection name MUST end with /`, { cause: { collection } });
  }

  const resultOfSelectResources = await database
    .with('all_members', (qb) => {
      return qb
        .selectFrom('spaceNamedResource')
        .select([
          sql<string>`
            CASE 
              WHEN position('/' in substr("spaceNamedResource"."name", ${collection.length + 1})) > 0
              AND "spaceNamedResource"."name" NOT LIKE '%/'
              THEN ${collection} || split_part(substr("spaceNamedResource"."name", ${collection.length + 1}), '/', 1) || '/'
              ELSE "spaceNamedResource"."name"
            END
          `.as('name'),
          sql<string | null>`
            CASE 
              WHEN position('/' in substr("spaceNamedResource"."name", ${collection.length + 1})) > 0
              AND "spaceNamedResource"."name" NOT LIKE '%/'
              THEN NULL
              ELSE "spaceNamedResource"."resourceId"
            END
          `.as('resourceId'),
          sql<boolean>`
            CASE 
              WHEN position('/' in substr("spaceNamedResource"."name", ${collection.length + 1})) > 0
              AND "spaceNamedResource"."name" NOT LIKE '%/'
              THEN TRUE
              ELSE "spaceNamedResource"."name" LIKE '%/'
            END
          `.as('isCollection'),
          'spaceNamedResource.spaceId'
        ])
        .where('spaceNamedResource.spaceId', '=', query.space)
        .where('spaceNamedResource.name', 'is not', null)
        .where('spaceNamedResource.name', 'like', collection + '%')
        .$if(!!collection, (qb) => qb.where('spaceNamedResource.name', '!=', collection));
    })
    .selectFrom('all_members')
    .leftJoin('resourceRepresentation', 'all_members.resourceId', 'resourceRepresentation.resourceId')
    .leftJoin('blob', 'resourceRepresentation.representationId', 'blob.uuid')
    .select([
      'all_members.name',
      'all_members.spaceId as space',
      'all_members.resourceId',
      'all_members.isCollection',
      sql<string[]>`array_agg(distinct "blob"."type") filter (where "blob"."type" is not null)`.as('mediaTypes')
    ])
    .groupBy(['all_members.name', 'all_members.spaceId', 'all_members.resourceId', 'all_members.isCollection'])
    .orderBy('all_members.name')
    .stream();

  yield* map(
    x => ({
      name: x.name,
      representation: (x.mediaTypes || []).map(mediaType => ({
        mediaType,
      }))
    }),
    resultOfSelectResources
  );
}