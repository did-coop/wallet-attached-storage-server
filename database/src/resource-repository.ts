import type { Insertable, QueryCreator } from "kysely"
import type { DatabaseTables, IRepository, IResource } from "./types"
import { map } from "streaming-iterables"

export default class ResourceRepository implements IRepository<IResource> {
  #database: QueryCreator<DatabaseTables>
  constructor(database: QueryCreator<DatabaseTables>) {
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
      .leftJoin('link', 'link.anchor', 'resourceRepresentation.resourceId')
      .select([
        'blob.bytes',
        'blob.type',
        'resourceRepresentation.createdAt',
        'spaceNamedResource.name',
        'spaceNamedResource.spaceId as space',
        'link.uuid as linkId',
        'link.anchor as linkAnchor',
      ])
      .where('spaceNamedResource.spaceId', '=', query.space)
      .$if(typeof query.name === 'string', qb => qb.where('spaceNamedResource.name', '=', query.name))
      .orderBy('resourceRepresentation.createdAt', 'desc')
      .execute()
    yield* map(x => {
      const fileName = `${x.linkAnchor || x.linkId || x.name || x.space}-${x.type}.json`.replace(/[\/\\:*?"<>|]/g, '_')
      return {
        blob: new File([x.bytes], fileName, { type: x.type }),
        createdAt: x.createdAt,
      }
    }, resultOfSelectRepresentations)
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
  const pattern =  /urn:uuid:(?<uuid>[^/]+)(?<path>\/(?<name>.*))/
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