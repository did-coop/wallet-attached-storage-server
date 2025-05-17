import { test } from "node:test";
import * as cli from "./index.js"
import { text } from "node:stream/consumers"

await test('cli', async t => {
  // await t.test('can be invoked', async (t) => {
  //   const stdout = new TransformStream
  //   const invocation = await cli.invoke(['push', '-n', 'myName', '-c'], {
  //     stdout: stdout.writable,
  //   })
  //   stdout.writable.close()
  //   const invocationStdout = await text(stdout.readable)
  //   console.log('invocation', invocation)
  //   console.log('invocationStdout', invocationStdout)
  // })
})
