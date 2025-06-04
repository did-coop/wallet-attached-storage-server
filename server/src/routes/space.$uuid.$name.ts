import { Hono } from "hono";
import type { Context, Env, Schema } from "hono";
import type { Database } from "wallet-attached-storage-database/types";
import ResourceRepository from "wallet-attached-storage-database/resource-repository";
import { collect } from "streaming-iterables";
import { authorizeWithSpace } from "../lib/authz-middleware.ts";
import SpaceRepository, { SpaceNotFound } from "wallet-attached-storage-database/space-repository";
import { createFactory } from 'hono/factory'

interface ISpaceResourceHonoOptions<P extends string> {
  space: (c: Context<Env, P>) => string | undefined,
  data: Database,
}

export class SpaceResourceHono<E extends Env, P extends string> extends Hono<E> {
  constructor(options: ISpaceResourceHonoOptions<P>) {
    super()
    this.configureRoutes(this, options)
  }
  configureRoutes = configureRoutes
}

/**
 * configure a hono to add space resource routes
 */
function configureRoutes<E extends Env, P extends string>(
  hono: Hono<E>,
  options: ISpaceResourceHonoOptions<P>
) {
  // use .on and multiple paths templates because route /:space/:name{.*} doesn't work with hono
  hono.on('delete', ['', ':name{.+}'], ...DELETE(options))
  hono.on('get', ['', ':name{.+}'], ...GET(options))
  hono.on('put', ['', ':name{.+}'], ...PUT(options))
}

const factory = createFactory<Env, `/space/:space/:name`>()

export const GET = <P extends string>(options: ISpaceResourceHonoOptions<P>) => {
  const resources = new ResourceRepository(options.data)
  const spaces = new SpaceRepository(options.data)
  const handleGet = factory.createHandlers(
    authorizeWithSpace({
      data: options.data,
      space: async (c) => {
        const spaceId = options.space(c)
        if (!spaceId) throw new Error(`unable to find space`, { cause: { spaceId } })
        return spaces.getById(spaceId)
      }
    }),
    async (c, next) => {
      const space = await options.space(c)
      if (!(space)) {
        return next()
      }
      const name = c.req.param('name') ?? ''
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
    }
  )
  return handleGet
}

export const DELETE = <P extends string>(options: ISpaceResourceHonoOptions<P>) => {
  const handle = factory.createHandlers(
    (c, next) => { // check if request is authorized to access the space
      const spaceId = options.space(c)
      const spaces = new SpaceRepository(options.data)
      const space = async () => {
        if (!spaceId) throw new Error(`unable to find space`, { cause: { spaceId } })
        return spaces.getById(spaceId)
      }
      const authorization = authorizeWithSpace({
        data: options.data,
        space
      })
      return authorization(c, next)
    },
    async (c, next) => {
      const space = await options.space(c)
      if (!(space)) {
        return next()
      }
      const name = c.req.param('name') ?? ''
      const resources = new ResourceRepository(options.data)
      const resultOfDelete = await resources.deleteById(`urn:uuid:${space}/${name}`)
      // @todo this should probably be 204
      return c.newResponse(null, 201)
    }
  )
  return handle
}

export const PUT = <P extends string>(options: ISpaceResourceHonoOptions<P>) => {
  const handlePut = factory.createHandlers(
    (c, next) => { // check if request is authorized to access the space
      const spaceId = options.space(c)
      const spaces = new SpaceRepository(options.data)
      const space = async () => {
        if (!spaceId) throw new Error(`unable to find space`, { cause: { spaceId } })
        return spaces.getById(spaceId)
      }
      const authorization = authorizeWithSpace({
        data: options.data,
        space
      })
      return authorization(c, next)
    },
    async (c, next) => {
      const spaceWithName = c.req.param('spaceWithName')
      const space = options.space(c)
      const name = c.req.param('name') ?? '';
      if (!(space)) {
        return next()
      }
      const representation = await c.req.blob()
      const resources = new ResourceRepository(options.data)
      await resources.putSpaceNamedResource({
        space,
        name: name ?? '',
        representation,
      })
      return c.newResponse(null, 201)
    });
  return handlePut
}
