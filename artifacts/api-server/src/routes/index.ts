import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openaiRouter from "./openai";
import portalRouter from "./portal";
import anthropicRouter from "./anthropic";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/openai", openaiRouter);
router.use("/anthropic", anthropicRouter);
router.use(portalRouter);

export default router;
