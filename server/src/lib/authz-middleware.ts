import type { Context, Next, Env } from "hono"
import type { Database, ISpace } from "wallet-attached-storage-database/types"
import { HTTPException } from "hono/http-exception"
import zcapAuthorizationMethod from "./authz-zcap.ts"
import { SpaceNotFound } from "wallet-attached-storage-database/space-repository"
import { authorizeRequestWithSpaceAcl } from "./authz-space-acl.ts"
import assertRequestIsSignedBySpaceController from "./authz-space-controller.ts"

type AuthzMethod = (request: Request) => Promise<boolean>

export function authorizeWithAnyOf(...authzMethods: AuthzMethod[]) {
  return async (c: Context, next: Next) => {
    for (const authz of authzMethods) {
      if (await authz(c.req.raw)) {
        return next()
      }
    }
    const message = `This request cannot be authorized`
    throw new HTTPException(401, {
      message,
      res: c.json({ message }, 401)
    })
  }
}

export function authorizeWithSpace(options: {
  space: (c: Context) => Promise<ISpace>,
  data: Database,
  trustHeaderXForwardedProto?: boolean,
  onSpaceNotFound?: (error: SpaceNotFound) => void,
  allowWhenSpaceNotFound?: boolean,
}) {
  // No space controller
  const withNoSpaceController = (o: { space: ISpace }) => async (request: Request) => {
    try {
      if (!o.space.controller) return true
    } catch (error) {
      if (error instanceof SpaceNotFound) return false
      throw error
    }
    return false
  }
  // HTTP Signature
  const withHttpSignature = (o: { space: ISpace }) => async (request: Request) => {
    const space = o.space
    try {
      await assertRequestIsSignedBySpaceController({
        request,
        space,
      })
      return true
    } catch (error) {
      // console.warn('error asserting request is signed by space controller', error)
      return false
    }
    return false
  }
  // ZCAP
  const withZcap = (o: { space: ISpace }) => async (request: Request) => {
    return zcapAuthorizationMethod(request, {
      ...options,
      space: async () => o.space,
    })
  }
  // ACL
  const withAcl = (o: { space: ISpace }) => (request) => authorizeRequestWithSpaceAcl(request, {
    ...options,
    space: async () => o.space,
  })
  return async (c: Context, next: Next) => {
    let space: ISpace
    try {
      space = await options.space(c)
    } catch (error) {
      if (error instanceof SpaceNotFound) {
        options.onSpaceNotFound?.(error)
        if (options.allowWhenSpaceNotFound) {
          return next()
        }
        return c.notFound()
      }
      throw error
    }
    return authorizeWithAnyOf(
      withNoSpaceController({ space }),
      withHttpSignature({ space }),
      withZcap({ space }),
      withAcl({ space }),
    )(c, next)
  }
}
