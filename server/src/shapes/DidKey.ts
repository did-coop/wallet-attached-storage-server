import { z } from "zod"

export const DidKeyShape = z.string().refine(did => {
  return did.startsWith('did:key:')
}, {
  message: 'MUST be a valid did:key DID',
})
