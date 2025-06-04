import type { Context, Next } from "hono"
import type SpaceRepository from "../../../database/src/space-repository.ts"
import { HttpSignatureAuthorization } from "authorization-signature"
import { getVerifierForKeyId } from "@did.coop/did-key-ed25519/verifier"
import { HTTPException } from 'hono/http-exception'
import { getControllerOfDidKeyVerificationMethod } from "@did.coop/did-key-ed25519/did-key"
import { PutSpaceRequestBodyShape } from "../shapes/PutSpaceRequestBody.ts"
import type { PutSpaceRequestBody } from "../shapes/PutSpaceRequestBody.ts"
import { treeifyError, z } from "zod/v4";

/**
 * build a route to get a space by uuid from a space repository
 * @param spaces - the space repository to query
 * @returns - hono handler
 */
export function GET(
  spaces: Pick<SpaceRepository, 'getById'>,
) {
  // hono request handler
  // use like
  //   (new Hono).get('/spaces/:uuid', GET(spaces))
  return async (c: Context<any, '/:uuid'>) => {
    const uuid = c.req.param('uuid')
    const space = await spaces.getById(uuid)
    if (!space) {
      // space does not exist
      // return 401. same as if space does exist but request includes insufficient authorization
      return c.newResponse(null, 401)
    }
    return c.json(space, 200)
  }
}

/**
 * build a route to PUT/update a space by uuid from a space repository
 * @param spaces - the space repository to query
 * @returns - hono handler
 */
export function PUT(
  spaces: Pick<SpaceRepository, 'getById' | 'create' | 'put'>,
) {
  // hono request handler
  // use like
  //   (new Hono).get('/spaces/:uuid', GET(spaces))
  return async (c: Context<any, '/:uuid'>) => {
    const uuid = c.req.param('uuid')
    const requestBodyObject = await c.req.json()
    const parsedPutSpaceRequest = PutSpaceRequestBodyShape.safeParse(requestBodyObject)
    if (parsedPutSpaceRequest.error) {
      throw new HTTPException(400, {
        message: `Invalid request body for PUT /spaces/${uuid}`,
        cause: parsedPutSpaceRequest.error,
      })
    }
    const spaceToCreate = {
      ...parsedPutSpaceRequest.data,
      uuid,
    }
    await spaces.put(spaceToCreate)
    return c.newResponse(null, 204)
  }
}

/**
 * build a route to delete a space by uuid from a space repository
 * @param spaces - the space repository to query
 * @returns - hono handler
 */
export function DELETE(
  spaces: Pick<SpaceRepository, 'deleteById'>,
) {
  // hono request handler
  // use like
  //   (new Hono).get('/spaces/:uuid', GET(spaces))
  return async (c: Context<any, '/:uuid'>) => {
    const uuid = c.req.param('uuid')
    await spaces.deleteById(uuid)
    return c.newResponse(null, 204)
  }
}

class AuthorizationMissing extends Error { }
class NotAuthorized extends Error { }

async function assertRequestAuthorizedBy(
  request: Request,
  controller: string,
) {
  if (!request.headers.get('authorization')) {
    throw new AuthorizationMissing(`Authorization is required but missing.`)
  }

  let authenticatedRequestKeyId: string
  try {
    const verified = await HttpSignatureAuthorization.verified(request, {
      async getVerifier(keyId) {
        const { verifier } = await getVerifierForKeyId(keyId)
        return verifier
      },
    })
    authenticatedRequestKeyId = verified.keyId
  } catch (error) {
    throw new Error(`Failed to verify HTTP Signature`, {
      cause: error,
    })
  }

  const authenticatedRequestDid = getControllerOfDidKeyVerificationMethod(authenticatedRequestKeyId as `did:key:${string}#${string}`)
  if (authenticatedRequestDid === controller) {
    // the request is authorized because it is signed by the controller
    return
  }

  throw new NotAuthorized(`Insufficient authorization provided to respond to this request.`)
}
