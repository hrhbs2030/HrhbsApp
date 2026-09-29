import { Router } from "express";
import { type IRouter } from "express";
import {
  ExtractTransactionRequestSchema,
  ExtractedTransactionSchema,
} from "@workspace/api-zod";
import { logger } from "../../lib/logger";

async function generateTransactionJson(text: string): Promise<string> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const completion = await openai.chat.completions.create({
    model: "gpt-5.6-luna",
    messages: [
      {
        role: "system",
        content: `أنت مساعد ذكي لاستخراج بيانات المعاملات من النصوص العربية.
استخرج البيانات التالية وأعد كائن JSON فقط، مع إرجاع null لكل حقل غير موجود:
- clientName: اسم العميل أو الشركة، نص لا يتجاوز 120 حرفًا
- service: نوع المعاملة أو الخدمة المطلوبة، نص لا يتجاوز 200 حرف
- serviceFee: أتعاب المكتب كرقم غير سالب أو null
- governmentFee: الرسوم الحكومية كرقم غير سالب أو null
- period: المدة المتوقعة لإنجاز المعاملة، نص لا يتجاوز 100 حرف
- duration: مدة المعاملة نفسها، نص لا يتجاوز 100 حرف
- receiptDate: تاريخ استلام المعاملة، نص لا يتجاوز 80 حرفًا
- notes: ملاحظات أخرى، نص لا يتجاوز 1000 حرف
لا تضف حقولًا أخرى ولا تستخدم markdown.`,
      },
      {
        role: "user",
        content: text,
      },
    ],
    response_format: { type: "json_object" },
  });

  const responseText = completion.choices[0]?.message?.content;
  if (!responseText) throw new Error("Empty AI response");
  return responseText;
}

export function createOpenAIRouter(
  generate: (text: string) => Promise<string> = generateTransactionJson,
): IRouter {
  const openAIRouter: IRouter = Router();

  openAIRouter.post("/extract-transaction", async (req, res) => {
    const request = ExtractTransactionRequestSchema.safeParse(req.body);
    if (!request.success) {
      return res.status(400).json({
        error: "أدخل وصفًا للمعاملة من حرف واحد إلى 2000 حرف فقط.",
      });
    }

    try {
      const responseText = await generate(request.data.text);
      const decoded: unknown = JSON.parse(responseText);
      const extracted = ExtractedTransactionSchema.safeParse(decoded);
      if (!extracted.success) {
        logger.warn("AI returned transaction data outside the expected schema");
        return res.status(502).json({
          error: "تعذر التحقق من البيانات المستخرجة. حاول مرة أخرى.",
        });
      }

      return res.json(extracted.data);
    } catch {
      logger.error("Transaction extraction service failed");
      return res.status(502).json({
        error: "تعذر استخراج بيانات المعاملة حاليًا. حاول مرة أخرى لاحقًا.",
      });
    }
  });

  return openAIRouter;
}

const openAIRouter = createOpenAIRouter();

export default openAIRouter;
