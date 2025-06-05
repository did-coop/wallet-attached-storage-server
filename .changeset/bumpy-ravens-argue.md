---
"wallet-attached-storage-database": minor
"wallet-attached-storage-server-nodejs": minor
"wallet-attached-storage-server-example-hono-node-server": minor
"wallet-attached-storage-server": minor
---

Add support for postgresql

This was a bit more involved than expected, because afaict sqlite3 and postgresql do not have any common data type for storing blobs. UUID data types and querything them is also slightly different. Where necessary, Kysely supports introspection such that the wallet-attached-storage-database modules can detect whether the database is backed by sqlite3 or postgresql and adjust behavior accordingly.
