import { z } from "zod"
import { DidKeyShape } from "./DidKey.ts"

export const PostSpaceRequestBodyShape = z.object({
  controller: DidKeyShape,
  name: z.string().optional(),
  uuid: z.string().optional(),
})
