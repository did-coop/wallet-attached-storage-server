import { describe, test } from 'node:test'
import { Server } from '../server.ts'
import { createDatabaseFromSqlite3Url } from 'wallet-attached-storage-database/sqlite3'
import * as wasdb from 'wallet-attached-storage-database'
import assert from 'assert'
import ResourceRepository from 'wallet-attached-storage-database/resource-repository'
import { collect } from 'streaming-iterables'

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
  // add html representation at collection name (for edge cases)
  {
    const collectionHtml = new Blob([`<!doctype html><h1>collection</h1>`], { type: 'text/html' })
    const resources = new ResourceRepository(database)
    await resources.putSpaceNamedResource({
      space: spaceUuid,
      name: collectionName,
      representation: collectionHtml,
    })
  }
  // get collection as text/html and expect the html representation
  {
    const request = new Request(`https://example.example/space/${spaceUuid}/${collectionName}`, {
      headers: {
        accept: `text/html`
      }
    })
    const response = await server.fetch(request)
    assert(response.ok, `response to get collection is ok`)
    assert.equal(response.headers.get('content-type'), 'text/html')
  }
  // get collection with no explicit accept header, expect collection json representation
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
    // check collection.totalItems
    {
      assert('totalItems' in objectFromResponse,
        `collection.totalItems is defined`)
      assert.equal(typeof objectFromResponse.totalItems, 'number',
        `objectFromResponse.totalItems is a number`)
      assert.ok(objectFromResponse.items.length <= objectFromResponse.totalItems,
        `collection.toalItems must be at least the length of collection.items`)
    }
    // check collection.items
    {
      assert('items' in objectFromResponse,
        `collection.items is defined`)
      assert.ok(Array.isArray(objectFromResponse.items),
        `collection.items is an array`)
    }
    // check collection.items includes example1 resource
    {
      const item = objectFromResponse.items[0]
      assert.ok(item, `first collection.items[] is ok`)
      assert.equal(item.name, resourceName)
    }

  }

  // let's test collection nesting
  // Given:
  //   a
  //   a/b/c1
  //   a/b/c2
  // When:
  //.* get a/
  // Then
  // * response collection only shows (collection) item a/b/

  await t.test(`get collection shows item for implicit child collection`, async t => {
    const resources = new ResourceRepository(database)
    const abcSpaceUuid = crypto.randomUUID()

    // add a space
    {
      await new wasdb.SpaceRepository(database).put({
        uuid: abcSpaceUuid,
      })
    }

    // add resources in the above structure (e.g. a/b/c1)
    {
      for (const name of [
        `a`,
        `a/b/c1`,
        `a/b/c2`,
      ]) {
        await resources.putSpaceNamedResource({
          space: abcSpaceUuid,
          name: name,
          representation: new Blob([JSON.stringify({ name })], { type: 'application/json' }),
        })
      }
    }

    // get collection a/ and expect to see a/b/
    {
      const requestUrl = `https://example.example/space/${abcSpaceUuid}/a/`
      const response = await server.fetch(new Request(requestUrl))

      assert.equal(response.status, 200)

      const collection = await response.json()
      assert.equal(collection.totalItems, 1)
      const item = collection.items[0]
      assert.deepEqual(item, { name: 'a/b/' })
    }

  })
})

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
