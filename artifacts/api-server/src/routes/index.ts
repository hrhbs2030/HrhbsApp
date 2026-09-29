import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openaiRouter from "./openai";
import portalRouter, { requireOfficeStaff } from "./portal";
import anthropicRouter from "./anthropic";

const router: IRouter = Router();

router.use(healthRouter);
// Transaction extraction spends the AI key, so only verified office staff may call it.
router.use("/openai", requireOfficeStaff, openaiRouter);
router.use("/anthropic", anthropicRouter);
router.use(portalRouter);

export default router;
