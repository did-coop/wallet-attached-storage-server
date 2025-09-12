/**
 * @file tests of how server behaves handling requests with `Authorization: Signature ...`
 * with a keyId=did:key:...
 */
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

await describe('wallet-attached-storage-server for web publishing', async t => {
  const database = await createTestDatabase()
  const server = new Server(database)

  let spaceUuid: string | undefined

  await test('PUT space, PUT homepage, GET it', async t => {
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
      controller: keyForAlice.controller,
      // configure pointer to links of space
      link: `/space/${spaceUuid}/links/`,
    }
    const request = createPutSpaceByUuidRequest(spaceToCreate)
    const response = await server.fetch(request)
    assert.equal(response.status, 204, 'response status to PUT /spaces/ MUST be 204')

    await t.test('GET space', async t => {
      const requestUrl = new URL(`/space/${spaceUuid}`, 'http://example.example')
      const requestMethod = 'GET'
      const response = await server.fetch(new Request(requestUrl, {
        method: requestMethod,
        headers: {
          authorization: await createHttpSignatureAuthorization({
            signer: keyForAlice,
            url: requestUrl,
            method: requestMethod,
            headers: {},
            includeHeaders: [
              '(created)',
              '(expires)',
              '(key-id)',
              '(request-target)',
            ],
            created: new Date,
            expires: new Date(Date.now() + 30 * 1000),
          })
        }
      }))
      assert.ok(
        response.ok,
        'response to PUT /space/:uuid/ MUST be ok')
      const objectFromResponse = await response.json()
      assert.equal(objectFromResponse.link, spaceToCreate.link)
    })

    await t.test('PUT homepage with http sig from space controller', async t => {
      const homepage = new Blob(['<!doctype html><h1>Home Page</h1><p>hello world<p>'], { type: 'text/html' })
      const requestUrl = new URL(`/space/${spaceUuid}/`, 'http://example.example')
      const requestMethod = 'PUT'
      const responseToPutHomepage = await server.fetch(new Request(requestUrl, {
        method: requestMethod,
        body: homepage,
        headers: {
          authorization: await createHttpSignatureAuthorization({
            signer: keyForAlice,
            url: requestUrl,
            method: requestMethod,
            headers: {},
            includeHeaders: [
              '(created)',
              '(expires)',
              '(key-id)',
              '(request-target)',
            ],
            created: new Date,
            expires: new Date(Date.now() + 30 * 1000),
          })
        }
      }))
      assert.ok(
        responseToPutHomepage.ok,
        'response to PUT /space/:uuid/ MUST be ok')
    })

    await t.test('GET homepage with http sig from space controller', async t => {
      const requestUrl = new URL(`/space/${spaceUuid}/`, 'http://example.example')
      const requestMethod = 'GET'
      const responseToPutHomepage = await server.fetch(new Request(requestUrl, {
        method: requestMethod,
        headers: {
          accept: 'text/html',
          authorization: await createHttpSignatureAuthorization({
            signer: keyForAlice,
            url: requestUrl,
            method: requestMethod,
            headers: {},
            includeHeaders: [
              '(created)',
              '(expires)',
              '(key-id)',
              '(request-target)',
            ],
            created: new Date,
            expires: new Date(Date.now() + 30 * 1000),
          })
        }
      }))
      if (!responseToPutHomepage.ok) {
        console.debug('responseToPutHomepage', responseToPutHomepage)
      }
      assert.ok(
        responseToPutHomepage.ok,
        `response to ${requestMethod} /space/:uuid/ MUST be ok`)
      const bodyOfHomepageResponse = await responseToPutHomepage.blob()
      assert.equal(bodyOfHomepageResponse.type, 'text/html', `body type of GET response MUST be text/html`)
    })

    await t.test('PUT /space/:space/links/ with acl link', async t => {
      const linkset = {
        linkset: [
          {
            anchor: `/space/${spaceUuid}/`,
            acl: [
              { href: `/space/${spaceUuid}/acl` },
            ]
          }
        ]
      }
      const blobForLinkset = new Blob(
        [JSON.stringify(linkset)],
        { type: 'application/linkset+json' }
      )
      const requestUrl = new URL(`/space/${spaceUuid}/links/`, 'http://example.example')
      const requestMethod = 'PUT'
      const responseToPutHomepage = await server.fetch(new Request(requestUrl, {
        method: requestMethod,
        body: blobForLinkset,
        headers: {
          authorization: await createHttpSignatureAuthorization({
            signer: keyForAlice,
            url: requestUrl,
            method: requestMethod,
            headers: {},
            includeHeaders: [
              '(created)',
              '(expires)',
              '(key-id)',
              '(request-target)',
            ],
            created: new Date,
            expires: new Date(Date.now() + 30 * 1000),
          })
        }
      }))
      assert.ok(
        responseToPutHomepage.ok,
        `response to PUT ${requestUrl.pathname} MUST be ok`)
    })


    await t.test('PUT acl', async t => {
      const acl = {
        authorization: [
          {
            agentClass: 'http://xmlns.com/foaf/0.1/Agent',
            accessTo: [
              `/space/${spaceUuid}/`,
            ],
            // default: `/space/${spaceUuid}/`,
            "mode": [
              "Read",
            ],
            "@type": [
              "http://www.w3.org/ns/auth/acl#Authorization"
            ],
          }
        ],
        "@context": [
          "http://www.w3.org/ns/auth/acl#",
        ],
      }
      const blobForAcl = new Blob([JSON.stringify(acl)], { type: 'application/json' })
      const requestUrl = new URL(`/space/${spaceUuid}/acl`, 'http://example.example')
      const requestMethod = 'PUT'
      const responseToPutHomepage = await server.fetch(new Request(requestUrl, {
        method: requestMethod,
        body: blobForAcl,
        headers: {
          authorization: await createHttpSignatureAuthorization({
            signer: keyForAlice,
            url: requestUrl,
            method: requestMethod,
            headers: {},
            includeHeaders: [
              '(created)',
              '(expires)',
              '(key-id)',
              '(request-target)',
            ],
            created: new Date,
            expires: new Date(Date.now() + 30 * 1000),
          })
        }
      }))
      assert.ok(
        responseToPutHomepage.ok,
        `response to PUT ${requestUrl.pathname} MUST be ok`)
    })


    await t.test('GET homepage sans auth (with acl set up)', async t => {
      const requestUrl = new URL(`/space/${spaceUuid}/`, 'http://example.example')
      const requestMethod = 'GET'
      const responseToPutHomepage = await server.fetch(new Request(requestUrl, {
        method: requestMethod,
        headers: {
          accept: 'text/html',
        }
      }))

      assert.ok(responseToPutHomepage.ok, `response to ${requestMethod} /space/:uuid/ sans auth MUST be ok`)

      const bodyOfHomepageResponse = await responseToPutHomepage.blob()
      assert.equal(bodyOfHomepageResponse.type, 'text/html', `body type of GET response MUST be text/html`)
    })
  })
})

export function urlWithProtocol(url: URL | string, protocol: `${string}:`) {
  const url2 = new URL(url)
  url2.protocol = protocol
  return url2
}