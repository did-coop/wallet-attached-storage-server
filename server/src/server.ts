import type { Fetchable } from "./types"
import type { Database } from 'wallet-attached-storage-database/types'
import { Hono } from 'hono'
import SpaceRepository from "../../database/src/space-repository.ts"
import { GET as getSpacesIndex } from './routes/spaces._index.ts'
import { POST as postSpacesIndex } from './routes/spaces._index.ts'
import { GET as getSpaceByUuid } from './routes/space.$uuid.ts'
import { PUT as putSpaceByUuid } from './routes/space.$uuid.ts'
import { DELETE as deleteSpaceByUuid } from './routes/space.$uuid.ts'
import { cors } from 'hono/cors'
import { authorizeWithSpace } from './lib/authz-middleware.ts'
import { SpaceResourceHono } from "./routes/space.$uuid.$name.ts"
import { HTTPException } from "hono/http-exception"
import { treeifyError, ZodError } from "zod/v4"
import { env } from 'hono/adapter'


interface IServerOptions {
  cors?: {
    origin?: (origin: string | undefined) => string | null
  },
  trustHeaderXForwardedProto?: boolean
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
    // add error handlerno to format ZodErrors
    hono.onError(async (error, c) => {

      if (error instanceof HTTPException && (error.cause as any)?.name === 'ZodError') {
        return c.json({
          type: `ParseError`,
          cause: treeifyError(error.cause as ZodError),
        },error.status)
      }

      if (error instanceof HTTPException) {
        return error.getResponse();
      }

      console.warn(`ERROR: Unexpected WAS Server Error`, error)

      const message = `Sorry, there was an unexpected error while handling your request.`
      const cause = env(c).PROD ? undefined : error
      return c.json({type:'UnexpectedError',message,cause},500)
    })

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

    // GET /space/:uuid
    hono.get('/space/:uuid',
      authorizeWithSpace({
        data,
        space: async (c) => spaces.getById(c.req.param('uuid'))
      }),
      getSpaceByUuid(spaces))

    // PUT /space/:uuid
    hono.put('/space/:uuid',
      authorizeWithSpace({
        data,
        space: async (c) => spaces.getById(c.req.param('uuid')),
        // this allows the initial PUT space request
        allowWhenSpaceNotFound: true,
      }),
      putSpaceByUuid(spaces))
    // DELETE /space/:uuid
    hono.delete('/space/:uuid',
      authorizeWithSpace({
        data,
        space: async (c) => spaces.getById(c.req.param('uuid')),
      }),
      deleteSpaceByUuid(spaces))

    // resources in a space
    // * /space/:space/:name{.*}
    hono.route('/space/:space/', new SpaceResourceHono({
      data,
      space: (c) => c.req.param('space'),
    }))
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
      throw error
    }
  }
}
