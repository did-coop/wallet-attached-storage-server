import type { Fetchable } from "./types"
import type { Database } from 'wallet-attached-storage-database/types'
import { Hono } from 'hono'
import { GET as getSpacesIndex } from './routes/spaces._index.ts'
import { POST as postSpacesIndex } from './routes/spaces._index.ts'
import { GET as getSpaceByUuid } from './routes/space.$uuid.ts'
import { PUT as putSpaceByUuid } from './routes/space.$uuid.ts'
import { ResourceRepository } from 'wallet-attached-storage-database'
import { SpaceRepository } from 'wallet-attached-storage-database'
import { collect } from "streaming-iterables"
import { cors } from 'hono/cors'

interface IServerOptions {
  cors?: {
    origin?: (origin: string | undefined) => string | null
  }
}

/**
 * Hono instance encapsulating HTTP routing for Wallet Attached Storage Server
 */
export class ServerHono extends Hono {
  constructor(data: Database, options?: IServerOptions) {
    super()
    ServerHono.configureRoutes(this, data, options)
  }
  static configureRoutes(hono: Hono, data: Database, options?: IServerOptions) {
    const spaces = new SpaceRepository(data)

    hono.use('*', cors({
      origin(origin, c) {
        return options?.cors?.origin?.(origin) ?? null
      },
    }))

    hono.get('/', async c => {
      return Response.json({
        name: 'Wallet Attached Storage',
        spaces: 'spaces',
        type: [
          'SpaceRepository',
          'Service',
        ],
      })
    })

    // redirect GET /spaces -> /spaces/ with trailing slash
    hono.get('/spaces', async c => c.redirect('/spaces/'))

    hono.get('/spaces/', getSpacesIndex(spaces))
    hono.post('/spaces/', postSpacesIndex(spaces))
    hono.get('/space/:uuid', getSpaceByUuid(spaces))
    hono.put('/space/:uuid', putSpaceByUuid(spaces))

    // GET /space/:uuid/:resourceName{.*}
    // ^ errors from within hono when the resourceName pattern can be an empty string
    const patternOfSpaceSlashName = /^(?<space>[^/]+)\/(?<name>.*)$/
    hono.get('/space/:spaceWithName{.+}', async (c, next) => {
      const spaceWithName = c.req.param('spaceWithName')
      const match = spaceWithName.match(patternOfSpaceSlashName)
      const space = match?.groups?.space
      const name = match?.groups?.name ?? ''
      if (!(space)) {
        return next()
      }
      const resources = new ResourceRepository(data)
      const representations = await collect(resources.iterateSpaceNamedRepresentations({
        space,
        name,
      }))
      if (representations.length === 0) {
        return c.notFound()
      }
      if (representations.length > 1) {
        console.warn(`found multiple representations for GET /space/${space}/${name}`, representations)
      }
      const [representation] = representations
      return c.newResponse(await representation.blob.bytes(), {
        headers: {
          "Content-Type": representation.blob.type,
        }
      })
    })

    // PUT /space/:uuid/:resourceName{.*}
    // ^ errors from within hono when the resourceName pattern can be an empty string
    hono.put('/space/:spaceWithName{.+}', async (c, next) => {
      const spaceWithName = c.req.param('spaceWithName')
      const match = spaceWithName.match(patternOfSpaceSlashName)
      const space = match?.groups?.space
      const name = match?.groups?.name
      if (!(space)) {
        return next()
      }
      const resources = new ResourceRepository(data)
      const representation = await c.req.blob()
      await resources.putSpaceNamedResource({
        space,
        name: name ?? '',
        representation,
      })
      return c.newResponse(null, 201)
    })
  }
}

/**
 * Wallet Attached Storage Server that delegates to ServerHono
 */
export class Server implements Fetchable {
  #data: Database
  #hono: Hono
  constructor(
    data: Database,
    options?: IServerOptions
  ) {
    this.#data = data
    this.#hono = new ServerHono(this.#data, options)
  }
  fetch = async (request: Request) => {
    try {
      const response = await this.#hono.fetch(request, {})
      return response
    } catch (error) {
      console.error('error', error)
      throw error
    }
  }
}
