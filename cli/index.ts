#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { Writable, Readable } from 'node:stream'
import { invoke } from "./invoke-cli.ts";
import { text } from "node:stream/consumers";

export { invoke } from "./invoke-cli.ts"

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  // this script is being invoked on a command line
  await invoke(process.argv.slice(2), {
    stdin: process.stdin ? Readable.toWeb(process.stdin) : undefined,
    stdout: Writable.toWeb(process.stdout),
    stderr: Writable.toWeb(process.stderr),
  })
}
