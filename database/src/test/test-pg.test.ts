import { test } from "node:test"
import * as assert from "node:assert"
import { createKyselyFromDatabaseUrl } from "wallet-attached-storage-server-nodejs/database-url"
import { initializeDatabaseSchema } from "../schema.ts"
import ResourceRepository from "../resource-repository.ts"
import SpaceRepository from "../space-repository.ts"
import { collect } from "streaming-iterables"

const TESTING_POSTGRESQL_URL = process.env.TESTING_POSTGRESQL_URL ?? `postgresql://`

await test('querying WAS database from postgresql URL', async t => {
  const database = createKyselyFromDatabaseUrl(TESTING_POSTGRESQL_URL)
  try {
    await initializeDatabaseSchema(database)

    const spaceA = crypto.randomUUID()

    const spaces = new SpaceRepository(database)
    // add a space
    {
      // add a space
      await spaces.create({
        name: spaceA,
        uuid: spaceA,
      })
    }

    await t.test('SpaceRepository#toArray', async t => {
      // just make sure this doesn't throw
      const spacesArray = await spaces.toArray()
      assert.ok(spacesArray.length > 0, `there is at least one space in result of spaces.toArray()`)
    })
    
    // add some resources
    {
      const resources = new ResourceRepository(database)

      // add resources in spaceA
      for (const name of [
        '',
        'a/b/c',
        'a/b2/c/d/e/f',
        'a/b'
      ]) {
        await resources.putSpaceNamedResource({
          space: spaceA,
          name,
          representation: new Blob([name], { type: 'text/plain' })
        })
      }
    }

    // show all members
    {
      const resources = new ResourceRepository(database)
      const resourcesAll = await collect(resources.iterateSpaceNamedRepresentations({
        space: spaceA,
      }))
    }

    // should be able to get members of root collection 
    {
      const resources = new ResourceRepository(database)
      const members = await collect(await resources.iterateSpaceCollectionMembers({
        space: spaceA,
      }))
      assert.deepEqual(members.map(m => m.name), ['', 'a/'])
    }

    // should be able to get members of collection a/
    {
      const resources = new ResourceRepository(database)
      const membersOfA = await collect(await resources.iterateSpaceCollectionMembers({
        space: spaceA,
        collection: 'a/',
      }))
      assert.deepEqual(membersOfA.map(m => m.name), ['a/b', 'a/b/', 'a/b2/'])
    }

  } finally {
    database.destroy()
  }
})
