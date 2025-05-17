#!/usr/bin/env node
import 'tsx'
const loaded = await import('../index.ts')
await loaded.main()
