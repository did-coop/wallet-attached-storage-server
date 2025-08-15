/**
 * @fileoverview
 * wallet.storage requires that clients be able to get and index (i.e. list)
 * items within a collection in a data space.
 * To enable this, the ResourceRepository should have a method to iterate
 * the items within a space + collection.
 * This file contains test for that.
 */

import { describe, test } from 'node:test'
import assert from "assert"
import { createDatabaseFromSqlite3Url } from '../sqlite3/database-url-sqlite3.ts'
import { initializeDatabaseSchema } from "../schema.ts"
import SpaceRepository from '../space-repository.ts'
import ResourceRepository from '../resource-repository.ts'
import type { Database, ISpace } from '../types.ts'
import { collect } from 'streaming-iterables'

await test(`index items in a space collection`, async t => {
  // setup database
  let database: Database
  {
    database = createDatabaseFromSqlite3Url(`sqlite3::memory:`)
    await initializeDatabaseSchema(database)
  }
  // create a space
  let createdSpace: ISpace
  {
    const spaceToCreate = {
      name: 'test-space',
      uuid: crypto.randomUUID(),
      controller: null,
      link: null,
    }
    await new SpaceRepository(database).create(spaceToCreate);
    createdSpace = spaceToCreate
  }
  // add resources to space/collection1/
  const resourcesToAdd: Array<[name: string, blob: Blob]> = [
    // this is a representation at the collection itself, but not an item of the collection
    [`collection1/`, new Blob(['resource1 content'], { type: 'text/plain' })],
    [`collection1/resource1`, new Blob(['resource1 content'], { type: 'text/plain' })],
    [`collection1/resource1`, new Blob(['<!doctype html>resource1'], { type: 'text/html' })],
    [`collection1/resource2`, new Blob(['resource2 content'], { type: 'text/plain' })],
    // add this to test whether iterating collection1/ includes nested items (it shouldn't)
    [`collection1/collection1-2/resource2`, new Blob(['resource2 content'], { type: 'text/plain' })],
    [`collection1/collection1-2/resource3`, new Blob(['resource3 content'], { type: 'text/plain' })],
    // add this so we're sure when we only want stuff from collection1, this isn't included
    [`resource4`, new Blob(['resource2 content'], { type: 'text/plain' })],
    // add this to ensure other collections and their items dont show up
    [`collection2/resource2`, new Blob(['resource2 content'], { type: 'text/plain' })],
  ]
  {
    for (const [name, representation] of resourcesToAdd) {
      await new ResourceRepository(database).putSpaceNamedResource({
        space: createdSpace.uuid,
        name,
        representation,
      })
    }
  }
  // get resources in space root collection /
  {
    const resources = new ResourceRepository(database)
    const collection1ItemsGenerator = resources.iterateSpaceCollectionDescendants({
      space: createdSpace.uuid,
      collection: '',
    })
    const collectionItems = await collect(collection1ItemsGenerator)
    assert.equal(collectionItems.length, 7)
  }
  // get resources in collection1/
  {
    const resources = new ResourceRepository(database)
    const collection1ItemsGenerator = resources.iterateSpaceCollectionDescendants({
      space: createdSpace.uuid,
      collection: `collection1/`
    })
    const collectionItems = await collect(collection1ItemsGenerator)
    assert.equal(collectionItems.length, 4)
  }
  // get resources in collection1/collection1-2/
  {
    const resources = new ResourceRepository(database)
    const itemsGenerator = resources.iterateSpaceCollectionDescendants({
      space: createdSpace.uuid,
      collection: `collection1/collection1-2/`
    })
    const items = await collect(itemsGenerator)
    assert.equal(items.length, 2)
  }
})
