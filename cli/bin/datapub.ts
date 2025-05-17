#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { Readable, Writable } from 'node:stream'
import { invoke } from "../invoke-cli.js";
import { realpath } from "node:fs/promises";

if (fileURLToPath(import.meta.url) === await realpath(process.argv[1])) {
  // this script is being invoked on a command line
  const stdin = process.stdin.isTTY ? undefined : Readable.toWeb(process.stdin)
  const { code } = await invoke(process.argv.slice(2), {
    console,
    stdin,
    stdout: Writable.toWeb(process.stdout),
    stderr: Writable.toWeb(process.stderr),
  })
  if (typeof code !== 'undefined') {
    process.exit(code)
  }
}
