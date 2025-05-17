import { test } from "node:test"
import { Hono } from "hono"
import * as honoNodeServer from "@hono/node-server"
import { invokeFetch, invokeFetchCommand } from "./invoke-cli.js";
import assert from "node:assert"
import { Console } from "node:console";
import { Writable } from "node:stream"
import { Ed25519Signer } from "@did.coop/did-key-ed25519"

const DID_KEY_ED25519_PREFIX = `did:key:z6Mk`

interface AddressInfo {
  address: string;
  family: string;
  port: number;
}

class AddressURL extends URL {
  constructor(address: AddressInfo|string|null) {
    if (!address) throw new Error('address is required')
    if (typeof address !== 'object') throw new Error(`address must be an object`)
    const urlString = `http://localhost:${address.port}`
    super(urlString)
  }
}

const noopConsole = new Console({
  stdout: new Writable,
})

await test('can test a sample http server + cli', async t => {
  const app = new Hono
  const requests: Array<{
    url: string,
    method: string,
    headers: Headers
  }> = []
  app.use(async (c, next) => {
    requests.push({
      url: c.req.url,
      method: c.req.method,
      headers: new Headers(c.req.raw.headers),
    })
    next()
  })
  app.get('/', async c => {
    return c.json({
      name: 'cli-test homepage'
    })
  })
  const server = honoNodeServer.serve({
    fetch: app.fetch,
    port: 0,
  })
  try {
    await new Promise((resolve) => server.on('listening', () => resolve(undefined)))
    const serverUrl = new AddressURL(server.address())
    // prepare signer to use to sign fetch requests
    const signer = await Ed25519Signer.generate()
    // fetch it
    await invokeFetchCommand(serverUrl, {
      method: 'GET',
      console: noopConsole,
      signer,
      verbose: false,
    })
    // check
    {
      assert.equal(requests.length, 1)
      const getRequest = requests.find(r => r.method === 'GET')
      assert.equal(getRequest?.url, serverUrl.toString())
      assert.ok(getRequest?.headers.has('authorization'), `get request MUST have an authorization header`)
      const expectedAuthorizationPrefix = `Signature keyId="${DID_KEY_ED25519_PREFIX}`
      assert.ok(getRequest?.headers.get('authorization')?.startsWith(expectedAuthorizationPrefix), `get request authorization hedaer MUST start with '${expectedAuthorizationPrefix}'`)
    }
  } finally {
    server.close()
  }
})
