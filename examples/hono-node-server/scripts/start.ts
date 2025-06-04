import { serve } from '@hono/node-server'
import { initializeDatabaseSchema } from 'wallet-attached-storage-database'
import {createDatabaseFromSqlite3Url} from 'wallet-attached-storage-database/sqlite3'
import WAS from 'wallet-attached-storage-server'

const data = createDatabaseFromSqlite3Url('sqlite::memory:')
await initializeDatabaseSchema(data)
const { fetch } = new WAS.Server(data)
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 0
const server = serve({
  fetch,
  port
}, (info) => {
  console.log(`Listening on http://localhost:${info.port}`)
})
