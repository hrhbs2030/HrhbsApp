import { Router, type IRouter, type Request, type RequestHandler, type Response } from "express";
import { LookupCommercialRegisterResponse } from "@workspace/api-zod";
import { requireOfficeStaff } from "../lib/office-access";
import { commercialRegisterNumber, lookupCommercialRegister, WathqError, wathqConfigured } from "../lib/wathq";
import { createRateLimitMiddleware } from "../middlewares/apiSecurity";
import { hasCustomerApproval, requireApprovedCustomer } from "./portal";

// Commercial register lookup while filling the company file: customers for
// their own file, office staff while editing a customer's. Each lookup costs
// a Wathq call, so the endpoint is rate limited per address on top of the
// API-wide limits.
const router: IRouter = Router();
const LOOKUPS_PER_MINUTE = 10;

export function crLookupHandler(fetchImpl: typeof fetch = fetch) {
  return async (req: Request, res: Response): Promise<void> => {
    const number = commercialRegisterNumber(String(req.query.number ?? ""));
    if (!number) { res.status(400).json({ error: "رقم السجل التجاري يتكون من 10 أرقام." }); return; }
    if (!wathqConfigured()) { res.status(503).json({ error: "التحقق من السجل التجاري غير متاح حاليًا." }); return; }
    try {
      res.json(LookupCommercialRegisterResponse.parse(await lookupCommercialRegister(number, fetchImpl)));
    } catch (error) {
      if (error instanceof WathqError && error.kind === "not_found") { res.status(404).json({ error: "لا يوجد سجل تجاري بهذا الرقم." }); return; }
      req.log.warn({ err: error }, "Commercial register lookup failed");
      res.status(502).json({ error: "تعذّر التحقق من السجل التجاري الآن. حاول مرة أخرى بعد قليل." });
    }
  };
}

const requireCustomerInPath: RequestHandler = async (req, res, next) => {
  const owner = String(req.params.userId ?? "");
  if (!owner || owner.length > 120 || !(await hasCustomerApproval(owner))) { res.status(404).json({ error: "Customer not found" }); return; }
  next();
};

const limit = () => createRateLimitMiddleware({ limit: LOOKUPS_PER_MINUTE, windowMs: 60_000, message: "طلبات تحقق كثيرة خلال وقت قصير. حاول مرة أخرى بعد دقيقة." });

router.get("/company/cr-lookup", requireApprovedCustomer, limit(), crLookupHandler());
router.get("/office/customers/:userId/cr-lookup", requireOfficeStaff, requireCustomerInPath, limit(), crLookupHandler());

export default router;
