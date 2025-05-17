import { parseArgs } from "node:util";
import { Console } from "node:console"
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import sshpk from "sshpk"
import type { ISigner } from "./types.js";
import { bytesToDataUri } from "./bytes.js";
import { encodeMutlibaseBase58btc } from "@did.coop/did-key-ed25519/multibase";
import * as nodePath from "node:path"
import { createHttpSignatureAuthorization } from "authorization-signature"
import { text } from "node:stream/consumers";
import type streamWeb from "node:stream/web"
import { getControllerOfDidKeyVerificationMethod } from "@did.coop/did-key-ed25519/did-key";
import dedent from "dedent"
import WAS from 'wallet-attached-storage-server'
import { initializeDatabaseSchema } from 'wallet-attached-storage-database'
import { serve } from '@hono/node-server'
import { Database } from 'wallet-attached-storage-database/types'
import { createDatabaseFromSqlite3Url, parseSqliteDatabaseUrl } from 'wallet-attached-storage-database/sqlite3'
import * as path from "path"
import {Kysely, SqliteDialect} from "kysely"
import Sqlite3Database from 'better-sqlite3'

/**
 * invoke the data.pub/cli command line interface
 * @param args - command line arguments
 * @returns descriptor of running cli process
 */
export async function invoke(args: string[], io?: {
  console?: typeof globalThis.console,
  stdin?: ReadableStream | streamWeb.ReadableStream
  stdout: WritableStream
  stderr: WritableStream
}, env = process.env): Promise<{ code: 0 | 1 }> {
  const console = io?.console ?? globalThis.console
  const stdout = io?.stdout || (new TransformStream).writable
  const stderr = io?.stderr || (new TransformStream).writable
  const stdin = io?.stdin
  const help = dedent`
  wallet-attached-storage-server

  Usage:
    wallet-attached-storage-server serve
  `
  const {
    values,
    positionals,
  } = parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: {
      verbose: {
        type: 'boolean',
        short: 'v',
        default: false,
      }
    },
  });

  const [command, ...commandPositionals] = positionals

  let showHelp = false
  let exitCode = 0
  switch (command) {
    case "help":
      showHelp = true
      break;
    case "serve":
      {
        // store data in-memory
        const data = createDatabaseFromEnv({
          DATABASE_URL: process.env.DATABASE_URL,
        })
        await initializeDatabaseSchema(data)

        const wasServer = new WAS.Server(data)
        const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 0
        const server = serve({
          fetch: wasServer.fetch,
          port
        }, (info) => {
          console.log(`Listening on http://localhost:${info.port}`)
        })
      }
      break;
    default:
      exitCode = 1
      showHelp = true
  }
  // unexpected command.
  // show usage.
  if (showHelp) {
    const stderrWriter = stderr.getWriter()
    await stderrWriter.write('\n')
    await stderrWriter.write(help)
    await stderrWriter.write('\n')
    stderrWriter.close()
  }
  // exit with code indicating error
  return {
    code: exitCode as 0 | 1,
  }
}

export async function invokeFetch(args: string[], options: {
  console?: typeof globalThis.console,
  env: Record<string, string | undefined>,
  stdin?: ReadableStream,
}) {
  const console = options.console ?? globalThis.console
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'identity': {
        type: 'string',
        short: 'i',
      },
      'content-type': {
        type: 'string',
      },
      'verbose': {
        type: 'boolean',
        short: 'v',
      }
    }
  })

  const contentType = parsed.values['content-type']
  const pathToKey = parsed.values.identity
  const pathToKeyExists = typeof pathToKey === "string" && existsSync(pathToKey.toString())
  let signer: undefined | ISigner
  if (pathToKeyExists) {
    const keyBuffer = readFileSync(pathToKey)
    // const privateKey = sshpk.parsePrivateKey(keyBuffer, undefined, {
    //   passphrase: options.env.DATAPUB_SSH_PASSPHRASE
    // })
    // signer = await SshpkSigner.fromPrivateKey(privateKey)
  }

  const [urlString, method] = parsed.positionals
  const url = new URL(urlString)
  await invokeFetchCommand(url, {
    headers: new Headers({
      ...(contentType && {
        'content-type': contentType,
      })
    }),
    stdin: options.stdin,
    console,
    signer,
    method,
    verbose: parsed.values.verbose ?? false,
  })
}

/**
 * invoke subcommand that sends http request via fetch
 */
export async function invokeFetchCommand(url: URL, options: {
  method: string
  console?: typeof globalThis.console,
  signer?: ISigner,
  verbose: boolean,
  stdin?: ReadableStream,
  headers?: Headers
}) {
  const console = options.console ?? globalThis.console
  const headers = Object.fromEntries(options.headers?.entries() ?? [])
  const authorization = options.signer ? await createHttpSignatureAuthorization({
    signer: options.signer,
    url,
    method: options.method,
    headers,
    includeHeaders: [
      '(created)',
      '(expires)',
      '(key-id)',
      '(request-target)',
      'host',
    ],
    created: new Date,
    expires: new Date(Date.now() + 1000 * 60),
  }) : undefined
  let body: ReadableStream | undefined
  switch (options.method) {
    case "GET":
    case "HEAD":
      // no body
      break;
    default:
      body = options.stdin
  }
  const request = new Request(url, {
    ...options,
    headers: {
      ...headers,
      ...(authorization && { authorization }),
    },
    ...(body && { body, duplex: 'half', })
  })
  const formatRequestForLog = (request: Request) => {
    return {
      type: [request.method, 'Request'],
      url: request.url,
      headers: Array.from(request.headers),
    }
  }
  const formatResponseForLog = (response: Response) => {
    return {
      type: ['Respond'],
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      headers: Array.from(response.headers),
    }
  }
  if (options.verbose) {
    console.debug('>', formatRequestForLog(request))
  }
  const response = await fetch(request)
  if (options.verbose) {
    console.debug('<', formatResponseForLog(response))
  }

  // print url of any location response header
  const locationFromResponseHedaers = response.headers.get('location')
  if (locationFromResponseHedaers) {
    const locationUrl = new URL(locationFromResponseHedaers, response.url)
    console.debug(locationUrl.toString())
    return;
  }

  const responseContentType = response.headers.get('content-type')
  switch (responseContentType) {
    case "application/json":
      console.debug(JSON.stringify(await response.json(), null, 2))
      break;
    default:
      console.debug(await response.text())
  }
}

async function invokeKey(
  args: string[],
  console: typeof globalThis.console = globalThis.console
) {
  const [pathToKey, ...argsAfterPathToKey] = args
  const keyBuffer = await readFile(pathToKey)
  const keyParsed = sshpk.parsePrivateKey(keyBuffer, 'auto')
  // const signer = await SshpkSigner.fromPrivateKey(keyParsed)

  const argsAfterKey = args.slice(1)

  const parsedArgs = parseArgs({
    strict: false,
    args: argsAfterPathToKey,
    allowPositionals: true,
  })
  const subcommand = parsedArgs.positionals[0]
  switch (subcommand) {
    case 'id':
    case undefined:
      // console.log(signer.id)
      break;
    case 'controller':
      // console.log(getControllerOfDidKeyVerificationMethod(signer.id as `did:key:${string}#${string}`))
      break;
    case 'sign':
    // return invokeKeySign(argsAfterPathToKey.slice(1), { signer })
    default:
      throw new Error(`unexpected key subcommand ${subcommand}`)
  }
}

async function invokeKeySign(args: string[], options: {
  signer: ISigner
}) {
  const parsedArgs = parseArgs({
    strict: false,
    options: {
      format: {
        type: 'string',
        default: 'data-uri',
      }
    },
    args,
    allowPositionals: true,
  })
  const dataString = parsedArgs.positionals[0]
  if (typeof dataString === 'undefined') {
    throw new Error(`Missing required positional arg: the data that should be signed`)
  }
  const data = new TextEncoder().encode(dataString)
  const signature = await options.signer.sign({ data })

  const supportedFormats = ['data-uri', 'multibaseBase58btc']
  switch (parsedArgs.values.format) {
    case "data-uri":
    case undefined:
      console.debug(bytesToDataUri(signature))
      break;
    case "multibaseBase58btc":
      console.debug(encodeMutlibaseBase58btc(signature))
      break;
    default:
      throw new Error(`unexpected format option: ${parsedArgs.values.format}. Supported values: ${supportedFormats.join(', ')}`)
  }
}

/**
 * called when cli is invoked with 'push' command
 * @param args command line argument strings
 */
async function invokePush(args: string[]) {
  // console.log('invokePush!', args)
  // console.log('TODO: map from this working directory to space data to be pushed')
  // console.log('TODO: PUT data to space')
}


/**
 * given environment variables, create a suitable Database.
 * Use env.DATABASE_URL if provided, otherwise create an in-memory database.
 */
export function createDatabaseFromEnv(env: {
  DATABASE_URL?: unknown
}) {
  if (env.DATABASE_URL) {
    console.debug('creating database from DATABASE_URL')
    const database = createDatabaseFromSqlite3Url(env.DATABASE_URL?.toString())
    const parsedUrl = parseSqliteDatabaseUrl(env.DATABASE_URL?.toString())
    const relativeDatabasePath = path.relative(process.cwd(), parsedUrl.pathname)
    console.debug('database pathname is', relativeDatabasePath)
    if (database) {
      return database
    }
  }
  // if no DATABASE_URL is provided, create an in-memory database
  const inMemoryDatabase = createInMemoryDatabase()
  console.debug('using in-memory database')
  return inMemoryDatabase
}

function createInMemoryDatabase() {
  const data: Database = new Kysely({
    dialect: new SqliteDialect({
      async database() {
        return new Sqlite3Database(':memory:')
      }
    })
  })
  return data
}
