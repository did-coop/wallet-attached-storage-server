import { z } from 'zod'
export const GetSpaceResponseShape = z.object({
  uuid: z.string(),
  name: z.string().or(z.null()).optional(),
  controller: z.string().or(z.null()).optional(),
})
