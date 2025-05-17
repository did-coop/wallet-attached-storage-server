import type { Context, Next } from 'hono'
import SpaceRepository from '../../../database/src/space-repository.ts'
import { CreateSpaceRequest } from '../api.zod.ts'
import { z } from 'zod'
import { HttpSignatureAuthorization } from 'authorization-signature'
import { getVerifierForKeyId } from "@did.coop/did-key-ed25519/verifier"
import { getControllerOfDidKeyVerificationMethod } from "@did.coop/did-key-ed25519/did-key"
import { createUuidV5 } from "../lib/uuid.ts"
import canonicalize from "canonicalize"
import { HTTPException } from 'hono/http-exception'

/**
 * build a route to get all spaces from a space repository
 * representing as a collection of space items
 * @param repo - the space repository to query
 * @returns - hono handler
 */
export const GET = (repo: SpaceRepository) => async (c: Context, next: Next) => {
  const spacesArray = await repo.toArray()
  return c.json({
    name: 'Spaces',
    items: spacesArray,
    totalItems: spacesArray.length,
    type: ['Collection'],
  })
}

/**
 * build a route that handles requests to create a space in a space repository
 * @param repo - the space repository to query/update
 * @returns - hono handler
 */
export const POST = (repo: SpaceRepository) => async (c: Context, next: Next) => {
  // check authorization
  let authenticatedClientDid: string | undefined
  if (c.req.raw.headers.get('authorization')) {
    console.debug('POST authorization', c.req.raw.headers.get('authorization'))
    try {
      const verified = await HttpSignatureAuthorization.verified(c.req.raw, {
        async getVerifier(keyId) {
          const { verifier } = await getVerifierForKeyId(keyId)
          return verifier
        },
      })
      const httpSignatureKeyIdDid = getControllerOfDidKeyVerificationMethod(verified.keyId)
      authenticatedClientDid = httpSignatureKeyIdDid
    } catch (error) {
      console.warn('error verifying authorization to POST /spaces/', error)
      throw new HTTPException(401, { message: `Failed to verify authorization`, cause: error })
    }
  }

  // request body is optional
  const bodyText = await c.req.text()
  let initialSpace
  if (!bodyText.trim()) {
    // no request body, no requestBodyObject
    initialSpace = {
      controller: authenticatedClientDid,
    }
  } else {
    initialSpace = JSON.parse(bodyText)
  }

  let createSpaceRequest: z.TypeOf<typeof CreateSpaceRequest>
  try {
    createSpaceRequest = CreateSpaceRequest.parse(initialSpace)
  } catch (error) {
    console.warn('error parsing request body', error)
    return c.json(error, 400)
  }

  const initialSpaceUuid = createSpaceRequest.uuid ?? createUuidV5({
    namespace: Uint8Array.from([]),
    name: new TextEncoder().encode(canonicalize(initialSpace)),
  })

  const created = await repo.create({
    ...createSpaceRequest,
    uuid: initialSpaceUuid,
  })
  const pathnameOfSpace = `/space/${initialSpaceUuid}`
  return c.newResponse(null, 201, {
    'Location': pathnameOfSpace,
  })
}
