import { SpaceRepository } from "wallet-attached-storage-database"
import ResourceRepository from "wallet-attached-storage-database/resource-repository"
import type { Database, ISpace } from "wallet-attached-storage-database/types"
import { z } from "zod"

async function parseLinksetJsonBlob(blob: Blob) {
  const text = await blob.text()
  const object = JSON.parse(text)
  return parseLinksetJsonFromObject(object)
}
const shapeOfLinkset = z.object({
  linkset: z.array(
    z.object({
      anchor: z.string(),
      acl: z.array(z.object({
        href: z.string(),
      })).optional(),
    }),
    z.object({
      anchor: z.string(),
    }),

  )
})
type LinksetFromZod = z.TypeOf<typeof shapeOfLinkset>
function parseLinksetJsonFromObject(object: unknown) {

  const parsedLinkset = shapeOfLinkset.parse(object)
  return parsedLinkset
}


interface ISpaceResourceHonoOptions<P extends string> {
  space: () => Promise<ISpace>
  data: Database,
}

class SpaceLinkParseError extends Error { }

export async function authorizeRequestWithSpaceAcl<P extends string>(
  request: Pick<Request, 'url' | 'method'>,
  options: ISpaceResourceHonoOptions<P>
): Promise<boolean> {
  const resources = new ResourceRepository(options.data)
  const spaces = new SpaceRepository(options.data)
  let effectiveAcl: Blob | undefined
  const space = await options.space()
  if (!space) return false

  if (!space.link) {
    return false
  }

  // we are going to determine the link to the space acl, if there is one
  let spaceAclResourceSelector:
    | { space: string, name: string }
    | undefined
  {
    let parsedLink: { space: string, name: string } | undefined

    try {
      // parse the link to see if we can understand it
      parsedLink = parseSpaceLink(space.link)
    } catch (error) {
      console.warn(`error parsing space.link value "${space.link}"`, error)
      return false // return false because request is not authorized
    }
    
    if (!parsedLink) {
      console.warn('unable to parse space link from value', space.link)
      return false // return false because request is not authorized
    }

    // We parsed the space link to a space resource.
    // Let's look up representations of that as a linkset.
    let linksetJsonRepresentation
    for await (const repr of resources.iterateSpaceNamedRepresentations(parsedLink)) {
      if (repr.blob.type === 'application/linkset+json') {
        linksetJsonRepresentation = repr
        break
      }
    }

    if (!linksetJsonRepresentation) return false

    const linkset = await parseLinksetJsonBlob(linksetJsonRepresentation.blob)

    const effectiveAclDetermination = await determineEffectiveAcl(
      resources, linkset, new URL(request.url).pathname)
    if (effectiveAclDetermination) {
      effectiveAcl = effectiveAclDetermination.blob
    }

    if (!effectiveAcl) {
      // there is no effective acl, so we can't authorize
      return false
    }
    if (effectiveAcl.type !== 'application/json') {
      throw new Error(`Unexpected ACL type: expected 'application/json', but got '${effectiveAcl.type}'.`, {
        cause: effectiveAcl.type,
      })
    }
    const aclObject = JSON.parse(await effectiveAcl.text())
    const acl = shapeOfSpaceAcl.parse(aclObject)
  }

  // if we could not determine an acl,
  // we cannot authorize the request
  if (!effectiveAcl) return false

  // there is an effectiveAcl.
  // try to parse it.
  let acl: ACL | undefined
  try {
    acl = shapeOfSpaceAcl.parse(JSON.parse(await effectiveAcl.text()))
  } catch (error) {
    console.warn('error while parsing effective ACL.', error)
    throw error
  }

  if (acl && checkIfRequestIsAuthorizedViaAcl(request, acl)) {
    return true
  }

  return false
}

type WacAcl = z.TypeOf<typeof shapeOfWacAcl>

type ACL = Exclude<Awaited<ReturnType<typeof queryAcl>>, undefined>

// we want to find authorizations relevant to this request
function* matchRequestToWacAcl(acl: WacAcl, request: { path: string, method: string }) {
  for (const authz of acl.authorization) {

    let accessToMatches = false
    if (authz.accessTo.includes(request.path)) {
      accessToMatches = true
    }

    let agentMatches = false
    if (authz.agentClass === 'http://xmlns.com/foaf/0.1/Agent') {
      // this is in docs as 'Allows access to any agent, i.e., the public.'
      agentMatches = true
    }

    let modeMatches = false
    let authzModeIsRead = false
    if (authz.mode.includes('Read')) authzModeIsRead = true
    if (authzModeIsRead && request.method === 'GET') modeMatches = true

    if ([accessToMatches, agentMatches, modeMatches].every(Boolean)) {
      yield authz
    }
  }
}

function matchRequestToPublicCanRead(acl: z.infer<typeof shapeOfPublicCanRead>, request: { url: string, method: string }) {
  const methodsAuthorizedByRead = ['GET', 'HEAD']
  return methodsAuthorizedByRead.includes(request.method)
}

function checkIfRequestIsAuthorizedViaAcl(
  request: Pick<Request, 'url' | 'method'>,
  acl: ACL
): boolean {

  // WAC ACL
  if ('authorization' in acl) {
    const relevantAuthorizations = acl
      ? Array.from(matchRequestToWacAcl(acl, {
        path: new URL(request.url).pathname,
        method: request.method,
      }))
      : []
    if (relevantAuthorizations.length > 0) {
      return true
    }
  }

  // PublicCanRead ACL
  const isPublicCanRead = 'type' in acl && (acl.type === 'PublicCanRead' || acl.type.includes('PublicCanRead'))
  if (isPublicCanRead && matchRequestToPublicCanRead(acl, request)) {
    return true
  }

  return false
}

const shapeOfWacAcl = z.object({
  authorization: z.array(z.object({
    agentClass: z.string(),
    accessTo: z.array(z.string()),
    mode: z.array(z.string()),
  }))
})

const shapeOfPublicCanRead = z.object({
  type: z.literal('PublicCanRead').or(z.array(z.string()).refine(items => items.includes('PublicCanRead'), { message: `type must include "PublicCanRead"` }))
})

const shapeOfSpaceAcl = z.union([
  shapeOfWacAcl,
  shapeOfPublicCanRead,
])

export class FailedToParseAcl extends Error { }

async function queryAcl(
  resources: ResourceRepository,
  selector: { space: string, name: string },
) {
  const spaceAclResource = selector &&
    (await resources.iterateSpaceNamedRepresentations(selector).next())?.value
  const spaceAclObject = spaceAclResource && JSON.parse(await spaceAclResource.blob.text())
  // const shapeOfSpaceAcl = z.union([shapeOfWacAcl,shapeOfPublicCanRead])
  try {
    const spaceAcl = spaceAclObject ? shapeOfSpaceAcl.parse(spaceAclObject) : undefined
    return spaceAcl
  } catch (error) {
    if (error instanceof z.ZodError) {
      const parseError = new FailedToParseAcl(
        `Failed to parse ACL for space ${selector.space} with name ${selector.name}: ${error.message}`,
        { cause: { error, selector } })
      throw parseError
    }
    throw error
  }
}

function parseSpaceLink(link: string) {
  const patternOfSpacePath = /\/space\/(?<space>[^/]+)\/(?<name>.*)/
  const match = link.match(patternOfSpacePath)
  if (match) {
    return {
      space: match.groups?.space!,
      name: match.groups?.name!,
    }
  }
  throw new Error(`unable to parse space link`)
}

function* iterateAclLinkTargets(linkset: LinksetFromZod) {
  for (const ctx of linkset.linkset) {
    for (const target of ctx.acl ?? []) {
      yield target
    }
  }
}

async function determineEffectiveAcl(
  resources: ResourceRepository,
  linkset: LinksetFromZod,
  resource: string,
) {
  // https://solidproject.org/TR/wac#effective-acl-resource
  // Let resource be the resource.
  // Let aclResource be the ACL resource of resource.
  const aclResource = getAclResourceOfResource(linkset, resource)
  // If resource has an associated aclResource with a representation, return aclResource.
  const aclResourceRepresentation = aclResource
    ? (await resources.iterateSpaceNamedRepresentations(aclResource).next()).value
    : undefined
  if (aclResourceRepresentation) {
    return aclResourceRepresentation
  }
  // Otherwise, repeat the steps using the container resource of resource.
  const containerResource = getContainerResource(resource)
  if (!containerResource) return
  return determineEffectiveAcl(resources, linkset, containerResource)
}

function getContainerResource(resource: string) {
  if (resource === '/') return
  const match = resource.match(/(?<container>.+?)(?<item>[^/]+\/?$)/)
  if (!match) throw new Error('failed to parse resource')
  const container = match?.groups?.container
  if (!container) throw new Error(`unable to determine container`)
  return container
}

function getAclResourceOfResource(
  linkset: LinksetFromZod,
  resource: string,
) {
  for (const link of linkset.linkset) {
    if (link.anchor !== resource) continue
    const acls = link.acl
    if (!acls) continue
    if (acls.length === 0) continue
    if (acls.length > 1) throw new Error(`anchor must not have more than one acl link target`)
    const aclLink = acls[0]
    const aclLinkHref = aclLink.href
    const parsed = parseSpaceLink(aclLink.href)
    if (!parsed) throw new Error(`failed to parse space link`, {
      cause: { link: aclLink }
    })
    return parsed
  }
}
