import { describe, test } from 'node:test'
import { serve } from '@hono/node-server'
import WAS from 'wallet-attached-storage-server'
import * as sqlite3 from 'wallet-attached-storage-database/sqlite3'
import * as DB from 'wallet-attached-storage-database'
import WalletAttachedStorageServerTests, { defaultCreateRequest } from 'wallet-attached-storage-server/tests'
import nodeAssert from 'node:assert'
import type { AddressInfo } from 'node:net'

/*
Run the test suite from wallet-attached-storage-server/tests
where the requests are invoked by directly calling `server.fetch(request)`
*/
await describe('WAS.Server#fetch', async () => {
  await test(`wallet-attached-storage-server/tests`, async t => {
    await new WalletAttachedStorageServerTests().test(t, {
      assert: nodeAssert,
      createRequest: defaultCreateRequest,
      createServer
    });

    function createServer() {
      const database = sqlite3.createDatabaseFromSqlite3Url('sqlite3::memory:')
      const schemaInitialized = DB.initializeDatabaseSchema(database)
      const server = new WAS.Server(database)
      return {
        async fetch(request) {
          await schemaInitialized
          return server.fetch(request)
        },
        close() { },
      }
    }
  })
});

/*
Run the test suite from wallet-attached-storage-server/tests
where the requests are invoked by actually using globalThis.fetch
to invoke against a WAS server running in node.js using @hono/node-server.
This is a good full end-to-end test of the http behavior in a prod-like environment.
*/
await describe('@hono/node-server serving WAS.Server', async () => {
  await test(`wallet-attached-storage-server/tests`, async t => {
    await new WalletAttachedStorageServerTests().test(t, {
      assert: nodeAssert,
      createRequest: defaultCreateRequest,
      createServer
    });

    // create a server that invokes request by proxying to a node.js server via globalThis.fetch
    function createServer() {
      const database = sqlite3.createDatabaseFromSqlite3Url('sqlite3::memory:')
      const schemaInitialized = DB.initializeDatabaseSchema(database)
      const wasServer = new WAS.Server(database)
      const nodeServer = serve({
        port: 0,
        fetch: wasServer.fetch,
      })
      return {
        async fetch(requestIn) {
          await schemaInitialized
          const nodeServerUrl = await createAddressUrl(nodeServer.address())

          // parse the request url and 
          const urlFromRequest = new URL(requestIn.url)
          nodeServerUrl.pathname = urlFromRequest.pathname
          nodeServerUrl.search = urlFromRequest.search

          const request = await createNewRequest(requestIn, nodeServerUrl)
          const response = await globalThis.fetch(request)

          return response
        },
        close() {
          nodeServer.close();
        },
      }
    }
  })
});

// given server.address(), try to build a URL object that represents the address
async function createAddressUrl(address: AddressInfo | string | null) {
  if (!address) throw new Error('address is null')
  if (typeof address === 'string') return new URL(address)
  const hostname = address.address === '::' ? `localhost:${address.port}` : address.address
  return new URL(`http://${hostname}`)
}

// create a new request object with the same properties as the original request
// but a new URL
async function createNewRequest(originalRequest: Request, newUrl: URL) {

  const newRequest = new Request(newUrl, {
    method: originalRequest.method,
    headers: originalRequest.headers,
    body: originalRequest.body,
    mode: originalRequest.mode,
    credentials: originalRequest.credentials,
    cache: originalRequest.cache,
    redirect: originalRequest.redirect,
    referrer: originalRequest.referrer,
    referrerPolicy: originalRequest.referrerPolicy,
    integrity: originalRequest.integrity,
  });

  return newRequest;
}
