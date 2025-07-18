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
import type { ISpace } from 'wallet-attached-storage-database/types'
import ResourceRepository from 'wallet-attached-storage-database/resource-repository'
import { collect } from 'streaming-iterables'
import { readFilesFromTar } from 'wallet-attached-storage-database/space-tar'

// create a database suitable for constructing a testable Server(database)
async function createTestDatabase() {
  const database = createDatabaseFromSqlite3Url('sqlite::memory:')
  await wasdb.initializeDatabaseSchema(database)
  return database
}

await test('server.fetch get collection', async t => {
  const database = await createTestDatabase()
  const server = new Server(database)
  const spaceUuid = crypto.randomUUID()
  // add a space
  {
    await new wasdb.SpaceRepository(database).put({
      uuid: spaceUuid,
    })
  }
  // add a resource in a collection
  const collectionName = `my-collection/`
  const resourceName = `${collectionName}example1`
  {
    const example1 = new File(['example1 content'], resourceName, { type: 'text/plain' })
    const resources = new ResourceRepository(database)
    await resources.putSpaceNamedResource({
      space: spaceUuid,
      name: example1.name,
      representation: example1,
    })
  }
  // get collection
  {
    const request = new Request(`https://example.example/space/${spaceUuid}/${collectionName}`)
    const response = await server.fetch(request)
    assert(response.ok, `response to get collection is ok`)
    // check response body is JSON Collection
    const objectFromResponse = await response.json()
    assert(typeof objectFromResponse === 'object', `response JSON is an object`)
    // check collection.type
    {
      assert('type' in objectFromResponse, `collection.type is defined`)
      assert(includes(objectFromResponse.type, `Collection`),
        `collection.type includes "Collection"`)
    }
    // check collection.items
    {
      assert('items' in objectFromResponse,
        `collection.items is defined`)
      assert.ok(Array.isArray(objectFromResponse.items),
        `collection.items is an array`)
    }
    // check collection.totalItems
    {
      assert('totalItems' in objectFromResponse,
        `collection.totalItems is defined`)
      assert.equal(typeof objectFromResponse.totalItems, 'number',
        `objectFromResponse.totalItems is a number`)
      assert.ok(objectFromResponse.items.length <= objectFromResponse.totalItems,
        `collection.toalItems must be at least the length of collection.items`)
    }
  }
})

// TODO: test if collection resource has html representation

/**
 * return true iff haystack contains needle.
 * Haystack can either be a single value or an array of values.
 * @param haystack 
 * @param needle 
 * @returns 
 */
function includes<V>(haystack: V | V[], needle: V): boolean {
  if (Array.isArray(haystack)) {
    return haystack.includes(needle)
  }
  return haystack === needle
}
