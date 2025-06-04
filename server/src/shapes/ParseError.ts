import { z } from "zod"

export const ParseErrorShape = z.object({
  type: z.literal(`ParseError`),
  cause: z.object({
    properties: z.record(z.object({
      errors: z.array(z.string()),
    }))
  })
})
