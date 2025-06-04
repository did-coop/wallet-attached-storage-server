import type { IAssert, IServer, ITestModule, ITestOptions } from './types.ts'
import simpleTest from "./tests/simple.ts"
import testSpaceCreate from "./tests/space-create.ts"

class WalletAttachedStorageServerTestSuite {
  tests: ITestModule[] = [
    simpleTest,
    testSpaceCreate,
  ]
  async test(t: import('node:test').TestContext, options: ITestOptions) {
    for (const test of this.tests) {
      await test(t, options)
    }
  }
}

export default WalletAttachedStorageServerTestSuite

export { defaultCreateRequest } from "./testing.ts"
