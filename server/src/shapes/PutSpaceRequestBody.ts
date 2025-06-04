import { z } from "zod"
import { DidKeyShape } from './DidKey.ts'

export const PutSpaceRequestBodyShape = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  controller: DidKeyShape,
  uuid: z.string().optional(),
  link: z.string().optional(),
})

export type PutSpaceRequestBody = z.infer<typeof PutSpaceRequestBodyShape>
