import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openaiRouter from "./openai";
import portalRouter from "./portal";
import officeAdminRouter from "./office-admin";
import { requireOfficeStaff } from "../lib/office-access";
import anthropicRouter from "./anthropic";

const router: IRouter = Router();

router.use(healthRouter);
// Transaction extraction spends the AI key, so only verified office staff may call it.
router.use("/openai", requireOfficeStaff, openaiRouter);
router.use("/anthropic", anthropicRouter);
router.use(portalRouter);
router.use(officeAdminRouter);

export default router;
