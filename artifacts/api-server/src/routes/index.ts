import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openaiRouter from "./openai";
import portalRouter from "./portal";
import anthropicRouter from "./anthropic";
import approvedInformationRouter from "./approved-information";
import officeAdminRouter from "./office-admin";
import billingRouter from "./billing";
import catalogRouter from "./catalog";
import remindersRouter from "./reminders";
import reportsRouter from "./reports";
import { requireOfficeStaff } from "../lib/office-access";

const router: IRouter = Router();

router.use(healthRouter);
// Transaction extraction spends AI credits: office staff only.
router.use("/openai", requireOfficeStaff, openaiRouter);
router.use("/anthropic", anthropicRouter);
router.use(portalRouter);
router.use(approvedInformationRouter);
router.use(officeAdminRouter);
router.use(catalogRouter);
router.use(billingRouter);
router.use(remindersRouter);
router.use(reportsRouter);

export default router;
