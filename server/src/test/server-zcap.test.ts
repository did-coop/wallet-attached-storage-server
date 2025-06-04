import { describe, test } from 'node:test'
import { Server } from '../server.ts'
import { createDatabaseFromSqlite3Url } from 'wallet-attached-storage-database/sqlite3'
import * as wasdb from 'wallet-attached-storage-database'
import assert from 'assert'
import { Ed25519Signer } from '@did.coop/did-key-ed25519'
import { createHttpSignatureAuthorization } from 'authorization-signature'
import MIMEType from "whatwg-mimetype"
import { createRequestForCapabilityInvocation } from 'dzcap/zcap-invocation-request'
import { delegate } from 'dzcap/delegation'

// create a database suitable for constructing a testable Server(database)
async function createTestDatabase() {
  const database = createDatabaseFromSqlite3Url('sqlite::memory:')
  await wasdb.initializeDatabaseSchema(database)
  return database
}

await describe('wallet-attached-storage-server ZCAP authorization', async t => {
  const database = await createTestDatabase()
  const server = new Server(database)

  let spaceUuid: string | undefined

  await test('PUT space and then GET with zcap', async t => {
    const keyForAlice = await Ed25519Signer.generate()
    spaceUuid = crypto.randomUUID()
    const createPutSpaceByUuidRequest = (spaceRepresentation: unknown) => new Request(new URL(`/space/${spaceUuid}`, 'http://example.example'), {
      method: 'PUT',
      body: JSON.stringify(spaceRepresentation),
      headers: {
        'Content-Type': 'application/json',
      },
    })
    const spaceToCreate = {
      controller: keyForAlice.controller
    }
    const request = createPutSpaceByUuidRequest(spaceToCreate)
    const response = await server.fetch(request)
    assert.equal(response.status, 204, 'response status to PUT /spaces/ MUST be 204')

    await t.test(`GET with no authorization`, async t => {
      const requestUrl = new URL(`/space/${spaceUuid}`, 'http://example.example')
      const requestMethod = 'GET'
      const responseToGetSpace = await server.fetch(new Request(requestUrl, {
        method: requestMethod,
        headers: {
          'Accept': 'application/json',
        },
      }))
      assert.equal(
        responseToGetSpace.status, 401,
        'response status to GET /space/:uuid MUST be 401')
    })

    await t.test(`GET with signature over capability-invocation authorized by space controller`, async t => {
      // introduce a new key that will be delegated to viz zcap
      const keyForBob = await Ed25519Signer.generate()
      const requestUrl = new URL(`/space/${spaceUuid}`, 'http://example.example')
      const requestMethod = 'GET'
      const capabilityForBobToGetResource = await delegate({
        signer: keyForAlice,
        capability: {
          id: `urn:uuid:${crypto.randomUUID()}`,
          controller: keyForBob.controller,
          invocationTarget: urlWithProtocol(requestUrl, 'https:').toString(),
          allowedAction: [requestMethod],
          parentCapability: `urn:zcap:root:${encodeURIComponent(urlWithProtocol(requestUrl, 'https:').toString())}`,
          "@context": ["https://w3id.org/zcap/v1"],
          expires: new Date(Date.now() + 30 * 1000).toISOString(),
        }
      })
      const requestToGetSpace = new Request(requestUrl, {
        ...await createRequestForCapabilityInvocation(urlWithProtocol(requestUrl, 'https:'), {
          invocationSigner: keyForBob,
          method: requestMethod,
          capability: capabilityForBobToGetResource,
        })
      })
      const responseToGetSpace = await server.fetch(requestToGetSpace)
      assert.equal(
        responseToGetSpace.status, 200,
        'response status to GET /space/:uuid MUST be 200')
      const spaceFromGet = await responseToGetSpace.json()
      assert.equal(spaceFromGet.controller, spaceToCreate.controller)
    })

    await t.test('PUT to controlled space with no authorization', async t => {
      // this should respond 401 because the space as already been added with a controller,
      // and this request to PUT/update it does not include any proof of authorization from the controller
      const spaceRepresentation = {
        name: `new name`
      }
      const requestToPutSpaceSansAuth = new Request(new URL(`/space/${spaceUuid}`, 'http://example.example'), {
        method: 'PUT',
        body: JSON.stringify(spaceRepresentation),
        headers: {
          'Content-Type': 'application/json',
        },
      })
      const responseToPutSpaceSansAuth = await server.fetch(requestToPutSpaceSansAuth)
      assert.equal(responseToPutSpaceSansAuth.status, 401, 'response status MUST be 401')
    })
  })

  await test('PUT space resource to space with did:key controller', async t => {
    const keyForAlice = await Ed25519Signer.generate()
    spaceUuid = crypto.randomUUID()
    const spaceToCreate = {
      controller: keyForAlice.controller
    }

    // create the space
    const requestToCreateSpace = new Request(new URL(`/space/${spaceUuid}`, 'http://example.example'), {
      method: 'PUT',
      body: JSON.stringify(spaceToCreate),
      headers: {
        'Content-Type': 'application/json',
      },
    })
    const responseToCreateSpace = await server.fetch(requestToCreateSpace)
    assert.equal(responseToCreateSpace.status, 204, 'response status to PUT /space/:uuid MUST be 204')

    // PUT /space/:space.uuid/:foo.uuid
    {
      const fooResourceUuid = crypto.randomUUID()
      const fooResourceUrl = new URL(`/space/${spaceUuid}/${fooResourceUuid}`, 'http://example.example')
      const fooObject = {
        name: 'foo'
      }

      // if no authorization is included with the request at all,
      // the response will have status 401
      // because some authorization is required to write to spaces with a controller.
      await t.test('with no authorization responds status 401', async t => {
        const requestToPutResourceJson = new Request(fooResourceUrl, {
          method: 'PUT',
          body: new Blob([JSON.stringify(fooObject)], { type: 'application/json' })
        })
        const responseToPutResourceJson = await server.fetch(requestToPutResourceJson)
        assert.equal(responseToPutResourceJson.status, 401, 'response status to PUT /space/:uuid/:uuid with no authz MUST be 401')
      })

      // keyForAlice should be able to invoke a root capability directly
      await t.test('invoking root zcap urn signed by space controller should respond ok', async t => {
        const requestUrl = fooResourceUrl
        const requestMethod = 'PUT'

        // use urlWithProtocol as a quirk because currently zcaps MUST use https not http.
        // @todo dont use https here if/when the server will accept that
        const requestUrlHttps = urlWithProtocol(requestUrl, 'https:')
        const rootCapabilityUrnForFooResource = `urn:zcap:root:${encodeURIComponent(requestUrlHttps.toString())}`

        const requestToPutFooResource = new Request(requestUrl, {
          ...await createRequestForCapabilityInvocation(requestUrlHttps, {
            invocationSigner: keyForAlice,
            method: requestMethod,
            capability: rootCapabilityUrnForFooResource,
          })
        })
        const responseToPutFooResource = await server.fetch(requestToPutFooResource)
        assert.ok(responseToPutFooResource.ok, 'response status MUST be ok')
      })

      // note: this has only one key signing the delegation to itself and then invoking it with same key
      await t.test('invoking zcap controlled by space controller should respond ok', async t => {
        const requestUrl = fooResourceUrl
        const requestMethod = 'PUT'

        // use urlWithProtocol as a quirk because currently zcaps MUST use https not http.
        // @todo dont use https here if/when the server will accept that
        const requestUrlHttps = urlWithProtocol(requestUrl, 'https:')
        const capabilityInvocationTarget = requestUrlHttps
        const rootCapabilityUrnForFooResource = `urn:zcap:root:${encodeURIComponent(capabilityInvocationTarget.toString())}`

        const capabilityForAliceToInvokeFoo = await delegate({
          signer: keyForAlice,
          capability: {
            id: `urn:uuid:${crypto.randomUUID()}`,
            controller: keyForAlice.controller,
            invocationTarget: capabilityInvocationTarget.toString(),
            parentCapability: rootCapabilityUrnForFooResource,
            "@context": ["https://w3id.org/zcap/v1"],
            expires: new Date(Date.now() + 30 * 1000).toISOString(),
          }
        })
        const requestToPutFooResource = new Request(requestUrl, {
          ...await createRequestForCapabilityInvocation(requestUrlHttps, {
            invocationSigner: keyForAlice,
            method: requestMethod,
            capability: capabilityForAliceToInvokeFoo,
          })
        })
        const responseToPutFooResource = await server.fetch(requestToPutFooResource)
        if (!responseToPutFooResource.ok) {
          console.debug('responseToPutFooResource', requestToPutFooResource.url, responseToPutFooResource)
        }
        assert.ok(responseToPutFooResource.ok, 'response status MUST be ok')
      })

      await t.test('delegating zcap to bob', async t => {
        const keyForBob = await Ed25519Signer.generate()
        const requestUrl = fooResourceUrl
        const requestMethod = 'PUT'

        // use urlWithProtocol as a quirk because currently zcaps MUST use https not http.
        // @todo dont use https here if/when the server will accept that
        const requestUrlHttps = urlWithProtocol(requestUrl, 'https:')
        const capabilityInvocationTarget = requestUrlHttps
        const rootCapabilityUrnForFooResource = `urn:zcap:root:${encodeURIComponent(capabilityInvocationTarget.toString())}`

        const capabilityForBobToInvokeFoo = await delegate({
          signer: keyForAlice,
          capability: {
            id: `urn:uuid:${crypto.randomUUID()}`,
            controller: keyForBob.controller,
            invocationTarget: capabilityInvocationTarget.toString(),
            parentCapability: rootCapabilityUrnForFooResource,
            "@context": ["https://w3id.org/zcap/v1"],
            expires: new Date(Date.now() + 30 * 1000).toISOString(),
          }
        })
        const requestToPutFooResource = new Request(requestUrl, {
          ...await createRequestForCapabilityInvocation(requestUrlHttps, {
            invocationSigner: keyForBob,
            method: requestMethod,
            capability: capabilityForBobToInvokeFoo,
          })
        })
        const responseToPutFooResource = await server.fetch(requestToPutFooResource)
        if (!responseToPutFooResource.ok) {
          console.debug('responseToPutFooResource', requestToPutFooResource.url, responseToPutFooResource)
        }
        assert.ok(responseToPutFooResource.ok, 'response status MUST be ok')
      })

    }
  })


})

export function urlWithProtocol(url: URL | string, protocol: `${string}:`) {
  const url2 = new URL(url)
  url2.protocol = protocol
  return url2
}