import type { ITestModule, ITestOptions } from "../types";
import { Ed25519Signer } from "@did.coop/did-key-ed25519"
import { createHttpSignatureAuthorization } from "authorization-signature"
import { inspect } from "util";
import { ParseErrorShape } from "../shapes/ParseError.ts"

/*
Note! this is not a conventional nodejs test runner file.
It exports a function that is meant to ba called by other test files.
It has tests that can be composed into other test suites.
*/

const testSpaceCreate: ITestModule = async function (t, options: ITestOptions) {

  t.test('can GET /spaces/', async function () {
    const { createRequest } = options
    const { createServer } = options
    const server = createServer()
    try {
      const response = await server.fetch(createRequest('/spaces/'))
      options.assert.equal(response.status, 200)
      options.assert.ok(response.ok, `response to GET /spaces/ MUST be ok`)
    } finally {
      server.close()
    }
  })

  // @todo test POST /spaces/ with a controller key, then try to GET it

  t.test('can POST /spaces/ then GET /spaces/ to ensure persistence', async function () {
    const { createRequest } = options
    const { createServer } = options
    const server = createServer()
    try {
      const keyForAlice = await Ed25519Signer.generate()
      const spaceToCreate = {
        name: `my space ${crypto.randomUUID()}`,
        uuid: crypto.randomUUID(),
        controller: keyForAlice.controller,
      }
      const response = await server.fetch(createRequest('/spaces/', {
        method: 'POST',
        body: JSON.stringify(spaceToCreate),
        headers: {
          'Content-Type': 'application/json',
        }
      }))
      // check response to POST /spaces/
      {
        if (!response.ok) {
          console.debug('response', response, await response.clone().text())
        }
        options.assert.ok(response.ok, `response to POST /spaces/ MUST be ok`)
        // response to POST /spaces/ MUST have a Location header linking to the space resource
        const locationHeader = response.headers.get('Location')
        options.assert.ok(locationHeader, `response to POST /spaces/ MUST have a Location header`)
      }

      // now GET /spaces/
      const responseToGetSpaces = await server.fetch(createRequest('/spaces/'))
      options.assert.ok(response.ok, `response to GET /spaces/ MUST be ok`)
      const spacesCollection = await responseToGetSpaces.json()
      options.assert.equal(spacesCollection.items.length, 1, `spacesCollection.length MUST be 1`)
      options.assert.equal(spacesCollection.items[0].name, spaceToCreate.name, `space.name from GET /spaces/ MUSt match space.name from POST /spaces/`)
    } finally {
      server.close()
    }
  })

  /*
  This tests POST /spaces/ with no request body and http signature authorization.
  */
  t.test('POST /spaces/ with http signature authorization and no request body', async t => {
    const key = await Ed25519Signer.generate()

    const { createRequest } = options
    const request = createRequest('/spaces/', {
      method: 'POST',
      body: null,
      headers: {
        authorization: await createHttpSignatureAuthorization({
          signer: key,
          url: new URL('/spaces/', 'http://example.example'),
          method: 'POST',
          headers: {},
          includeHeaders: ['(key-id)', '(created)', '(expires)', '(request-target)'],
          created: new Date,
          expires: new Date(Date.now() + 30 * 1000),
        })
      }
    })

    const { createServer } = options
    const server = createServer()
    try {
      const response = await server.fetch(request)
      if (!response.ok) {
        console.debug('response', response, await response.clone().text())
      }
      options.assert.equal(response.ok, true, `response to POST /spaces/ MUST be ok`)
    } finally {
      server.close()
    }
  })

  /**
   * Often, the client will want to set their local keypair to be the controller of the space.
   * This should be possible by submitting the initial representation of the space with a
   * `controller` property set to a did:key DID.
   */
  t.test('POST /spaces/ with did:key controller', async t => {
    const key = await Ed25519Signer.generate()

    const { createRequest } = options
    const spaceToCreate = {
      controller: key.controller,
      uuid: crypto.randomUUID(),
    }
    const request = createRequest('/spaces/', {
      method: 'POST',
      body: new Blob(
        [JSON.stringify(spaceToCreate)],
        { type: 'application/json', }
      ),
      headers: {
        authorization: await createHttpSignatureAuthorization({
          signer: key,
          url: new URL('/spaces/', 'http://example.example'),
          method: 'POST',
          headers: {},
          includeHeaders: [
            '(key-id)',
            '(created)',
            '(expires)',
            '(request-target)'
          ],
          created: new Date,
          expires: new Date(Date.now() + 30 * 1000),
        })
      }
    })

    const { createServer } = options
    const server = createServer()
    try {
      const response = await server.fetch(request)
      if (!response.ok) {
        console.debug('response', response, await response.clone().text())
      }
      options.assert.equal(response.ok, true, `response to POST /spaces/ MUST be ok`)

      // The response should have a location header
      const locationHeader = response.headers.get('Location')
      options.assert.ok(locationHeader, `response to POST /spaces/ MUST have a Location header`)

      /*
      Ok, at this point we have added the space to the server.
      It should also have saved the controller.
      Let's verify that the controller is set correctly.
      */
      {
        // fetch the space with a GET request
        const urlOfAdded = new URL(locationHeader, new URL(response.url || request.url))
        const requestToGetSpace = createRequest(urlOfAdded)
        const responseToGetSpace = await server.fetch(requestToGetSpace)

        // the response status is 401
        // because the request does not include sufficient authorization to access the space
        options.assert.equal(responseToGetSpace.status, 401, `response status to GET /spaces/ with no authz MUST be 401`)
      }

      // now verify that a signature from the controller key is sufficient to access the space
      {
        const requestToGetSpace = createRequest(locationHeader, {
          headers: {
            authorization: await createHttpSignatureAuthorization({
              signer: key,
              url: new URL(locationHeader, 'http://example.example'),
              method: 'GET',
              headers: {},
              includeHeaders: [
                '(expires)',
                '(created)',
                '(key-id)',
                '(request-target)',
              ],
              created: new Date,
              expires: new Date(Date.now() + 30 * 1000),
            })
          }
        })

        const responseToGetSpace = await server.fetch(requestToGetSpace)
        options.assert.equal(responseToGetSpace.status, 200, `response status to GET /spaces/ MUST be 200`)

        const spaceFromResponse = await responseToGetSpace.json()
        options.assert.equal(spaceFromResponse.controller, key.controller, `space controller MUST be the same as the key controller`)
      }
    } finally {
      server.close()
    }
  })

  /**
   * If the client adds a space with no controller,
   * it can lead to a state where the space is added, but without enough information to
   * authorize subsequence requests.
   * This may be desirable for advanced users, but it can also be surprising and lead to confusion,
   * esp when first using the protocol.
   * This test simulates a client invoking add space without a controller,
   * and expects the server to return a 400 Bad Request response.
   * @see <https://github.com/gobengo/wallet.storage/issues/5>
   */
  t.test(`adding a space with no controller may respond with status 400`, async t => {
    const spaceUuid = crypto.randomUUID()
    const { createRequest } = options
    const path = `/spaces/`
    const method = `POST`
    const spaceToCreate = {
      id: `urn:uuid:${spaceUuid}`
    }
    const request = createRequest(path, {
      method,
      body: JSON.stringify(spaceToCreate),
      headers: {
        'Content-Type': 'application/json',
      }
    })
    const { createServer } = options
    const server = createServer()
    try {
      const response = await server.fetch(request)
      options.assert.equal(response.status, 400, `if not ok, response status to ${method} ${path} MUST be 400`)
      const responseBody = await response.json()
      const parsedResponseBody = ParseErrorShape.safeParse(responseBody)
      try {
        options.assert.ok(parsedResponseBody.success, `response body MUST be a ParseError shape`)
      } catch (error) {
        if (error instanceof Error && error.name === 'AssertionError') console.warn('Bad response body', inspect(responseBody, { depth: Infinity }));
        throw error
      }
    } catch (error) {
      throw error
    } finally {
      await server.close()
    }
  })
}

export default testSpaceCreate
