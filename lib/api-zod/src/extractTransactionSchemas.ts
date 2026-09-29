import { z } from "zod";

export const ExtractTransactionRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
  })
  .strict();

export const ExtractedTransactionSchema = z
  .object({
    clientName: z.string().max(120).nullable(),
    service: z.string().max(200).nullable(),
    serviceFee: z.number().finite().nonnegative().nullable(),
    governmentFee: z.number().finite().nonnegative().nullable(),
    period: z.string().max(100).nullable(),
    duration: z.string().max(100).nullable(),
    receiptDate: z.string().max(80).nullable(),
    notes: z.string().max(1000).nullable(),
  })
  .strict();