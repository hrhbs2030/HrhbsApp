import { getAuth } from "@clerk/express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, hbsCompanies, hbsCompanyEmployees, hbsCompanyLicenses, hbsDocumentReminders, hbsRegistrationRequests,
  hbsServiceRequests,
} from "@workspace/db";
import {
  CreateEmployeeBody, CreateLicenseBody, GetCompanyFileResponse, GetEmployeeNumbersResponse,
  GetOfficeCustomerFileResponse, ListOfficeCustomersResponse, SaveCompanyBody, SaveCompanyResponse,
  UpdateEmployeeResponse, UpdateLicenseResponse,
} from "@workspace/api-zod";
import { recordAudit, type AuditEntry } from "../lib/audit";
import {
  MAX_EMPLOYEES, MAX_LICENSES, company, companyFile, companyValues, employee, employeeValues,
  license, licenseValues, subjectLabels, subjectOf, syncEmployeeReminders, syncLicenseReminder,
} from "../lib/company";
import { riyadhToday } from "../lib/document-reminders";
import { requestReference } from "../lib/money";
import { officeCustomer } from "../lib/office-search";
import { requireOfficeStaff } from "../lib/office-access";
import { hasCustomerApproval, requireApprovedCustomer } from "./portal";

const router: IRouter = Router();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Who is acting and on whose file. Customers act on their own file; office
// staff on the customer named in the path, and every office change is audited.
type Scope = { owner: string; actor: string; office: boolean };

function customerScope(req: Request): Scope {
  const userId = getAuth(req).userId!;
  return { owner: userId, actor: userId, office: false };
}

async function officeScope(req: Request, res: Response): Promise<Scope | null> {
  const owner = String(req.params.userId ?? "");
  if (!owner || owner.length > 120 || !(await hasCustomerApproval(owner))) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return { owner, actor: getAuth(req).userId!, office: true };
}

async function audit(tx: Tx, scope: Scope, entry: Omit<AuditEntry, "actorId" | "targetType" | "targetId">) {
  if (!scope.office) return;
  await recordAudit(tx, { actorId: scope.actor, targetType: "customer", targetId: scope.owner, ...entry });
}

const invalid = (res: Response, what: string) => res.status(400).json({ error: `Check the ${what} details.` });
const id = (req: Request) => {
  const value = Number(req.params.id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};
// Validate a response but send the object itself: calendar dates stay YYYY-MM-DD.
function send(res: Response, status: number, schema: { parse: (v: unknown) => unknown }, body: unknown) {
  schema.parse(body);
  res.status(status).json(body);
}

// ---- handlers shared by both scopes ---------------------------------------------

async function saveCompany(scope: Scope, req: Request, res: Response) {
  if (!SaveCompanyBody.safeParse(req.body).success) { invalid(res, "company"); return; }
  let values;
  try { values = companyValues(req.body); } catch { invalid(res, "company"); return; }
  const row = await db.transaction(async tx => {
    const set = { ...values, updatedBy: scope.actor, updatedAt: new Date() };
    const [saved] = await tx.insert(hbsCompanies).values({ userId: scope.owner, ...set })
      .onConflictDoUpdate({ target: hbsCompanies.userId, set }).returning();
    await audit(tx, scope, { action: "company.update", details: { name: saved.name } });
    return saved;
  });
  res.json(SaveCompanyResponse.parse(company(row)));
}

async function createEmployee(scope: Scope, req: Request, res: Response) {
  if (!CreateEmployeeBody.safeParse(req.body).success) { invalid(res, "employee"); return; }
  let values;
  try { values = employeeValues(req.body); } catch { invalid(res, "employee"); return; }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(hbsCompanyEmployees)
    .where(eq(hbsCompanyEmployees.userId, scope.owner));
  if (count >= MAX_EMPLOYEES) { res.status(409).json({ error: `A company file can hold ${MAX_EMPLOYEES} employees.` }); return; }
  const row = await db.transaction(async tx => {
    const [created] = await tx.insert(hbsCompanyEmployees).values({ userId: scope.owner, createdBy: scope.actor, ...values }).returning();
    await syncEmployeeReminders(tx, created);
    await audit(tx, scope, { action: "employee.create", details: { employeeId: created.id, name: created.fullName } });
    return created;
  });
  send(res, 201, UpdateEmployeeResponse, employee(row));
}

async function updateEmployee(scope: Scope, req: Request, res: Response) {
  const employeeId = id(req);
  if (!employeeId || !CreateEmployeeBody.safeParse(req.body).success) { invalid(res, "employee"); return; }
  let values;
  try { values = employeeValues(req.body); } catch { invalid(res, "employee"); return; }
  const row = await db.transaction(async tx => {
    const [updated] = await tx.update(hbsCompanyEmployees).set({ ...values, updatedAt: new Date() })
      .where(and(eq(hbsCompanyEmployees.id, employeeId), eq(hbsCompanyEmployees.userId, scope.owner))).returning();
    if (!updated) return null;
    await syncEmployeeReminders(tx, updated);
    await audit(tx, scope, { action: "employee.update", details: { employeeId: updated.id, name: updated.fullName } });
    return updated;
  });
  if (!row) { res.status(404).json({ error: "Employee not found" }); return; }
  send(res, 200, UpdateEmployeeResponse, employee(row));
}

async function deleteEmployee(scope: Scope, req: Request, res: Response) {
  const employeeId = id(req);
  if (!employeeId) { res.status(404).json({ error: "Employee not found" }); return; }
  const removed = await db.transaction(async tx => {
    const [row] = await tx.delete(hbsCompanyEmployees)
      .where(and(eq(hbsCompanyEmployees.id, employeeId), eq(hbsCompanyEmployees.userId, scope.owner))).returning();
    if (row) await audit(tx, scope, { action: "employee.delete", details: { employeeId: row.id, name: row.fullName } });
    return row;
  });
  if (!removed) { res.status(404).json({ error: "Employee not found" }); return; }
  res.status(204).end();
}

async function employeeNumbers(scope: Scope, req: Request, res: Response) {
  const employeeId = id(req);
  if (!employeeId) { res.status(404).json({ error: "Employee not found" }); return; }
  const row = await db.transaction(async tx => {
    const [found] = await tx.select().from(hbsCompanyEmployees)
      .where(and(eq(hbsCompanyEmployees.id, employeeId), eq(hbsCompanyEmployees.userId, scope.owner))).limit(1);
    // Recorded before the numbers leave the server.
    if (found) await audit(tx, scope, { action: "employee.reveal", details: { employeeId: found.id, name: found.fullName } });
    return found;
  });
  if (!row) { res.status(404).json({ error: "Employee not found" }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetEmployeeNumbersResponse.parse({ idNumber: row.idNumber, passportNumber: row.passportNumber }));
}

async function createLicense(scope: Scope, req: Request, res: Response) {
  if (!CreateLicenseBody.safeParse(req.body).success) { invalid(res, "license"); return; }
  let values;
  try { values = licenseValues(req.body); } catch { invalid(res, "license"); return; }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(hbsCompanyLicenses)
    .where(eq(hbsCompanyLicenses.userId, scope.owner));
  if (count >= MAX_LICENSES) { res.status(409).json({ error: `A company file can hold ${MAX_LICENSES} licenses.` }); return; }
  const row = await db.transaction(async tx => {
    const [created] = await tx.insert(hbsCompanyLicenses).values({ userId: scope.owner, createdBy: scope.actor, ...values }).returning();
    await syncLicenseReminder(tx, created);
    await audit(tx, scope, { action: "license.create", details: { licenseId: created.id, title: created.title } });
    return created;
  });
  send(res, 201, UpdateLicenseResponse, license(row));
}

async function updateLicense(scope: Scope, req: Request, res: Response) {
  const licenseId = id(req);
  if (!licenseId || !CreateLicenseBody.safeParse(req.body).success) { invalid(res, "license"); return; }
  let values;
  try { values = licenseValues(req.body); } catch { invalid(res, "license"); return; }
  const row = await db.transaction(async tx => {
    const [updated] = await tx.update(hbsCompanyLicenses).set({ ...values, updatedAt: new Date() })
      .where(and(eq(hbsCompanyLicenses.id, licenseId), eq(hbsCompanyLicenses.userId, scope.owner))).returning();
    if (!updated) return null;
    await syncLicenseReminder(tx, updated);
    await audit(tx, scope, { action: "license.update", details: { licenseId: updated.id, title: updated.title } });
    return updated;
  });
  if (!row) { res.status(404).json({ error: "License not found" }); return; }
  send(res, 200, UpdateLicenseResponse, license(row));
}

async function deleteLicense(scope: Scope, req: Request, res: Response) {
  const licenseId = id(req);
  if (!licenseId) { res.status(404).json({ error: "License not found" }); return; }
  const removed = await db.transaction(async tx => {
    const [row] = await tx.delete(hbsCompanyLicenses)
      .where(and(eq(hbsCompanyLicenses.id, licenseId), eq(hbsCompanyLicenses.userId, scope.owner))).returning();
    if (row) await audit(tx, scope, { action: "license.delete", details: { licenseId: row.id, title: row.title } });
    return row;
  });
  if (!removed) { res.status(404).json({ error: "License not found" }); return; }
  res.status(204).end();
}

// ---- customer routes -------------------------------------------------------------

router.get("/company", requireApprovedCustomer, async (req, res): Promise<void> => {
  send(res, 200, GetCompanyFileResponse, await companyFile(customerScope(req).owner));
});
router.put("/company", requireApprovedCustomer, (req, res) => saveCompany(customerScope(req), req, res));
router.post("/company/employees", requireApprovedCustomer, (req, res) => createEmployee(customerScope(req), req, res));
router.put("/company/employees/:id", requireApprovedCustomer, (req, res) => updateEmployee(customerScope(req), req, res));
router.delete("/company/employees/:id", requireApprovedCustomer, (req, res) => deleteEmployee(customerScope(req), req, res));
router.get("/company/employees/:id/numbers", requireApprovedCustomer, (req, res) => employeeNumbers(customerScope(req), req, res));
router.post("/company/licenses", requireApprovedCustomer, (req, res) => createLicense(customerScope(req), req, res));
router.put("/company/licenses/:id", requireApprovedCustomer, (req, res) => updateLicense(customerScope(req), req, res));
router.delete("/company/licenses/:id", requireApprovedCustomer, (req, res) => deleteLicense(customerScope(req), req, res));

// ---- office routes ------------------------------------------------------------------

const asOffice = (handler: (scope: Scope, req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response) => {
    const scope = await officeScope(req, res);
    if (scope) await handler(scope, req, res);
  };

router.put("/office/customers/:userId/company", requireOfficeStaff, asOffice(saveCompany));
router.post("/office/customers/:userId/employees", requireOfficeStaff, asOffice(createEmployee));
router.put("/office/customers/:userId/employees/:id", requireOfficeStaff, asOffice(updateEmployee));
router.delete("/office/customers/:userId/employees/:id", requireOfficeStaff, asOffice(deleteEmployee));
router.get("/office/customers/:userId/employees/:id/numbers", requireOfficeStaff, asOffice(employeeNumbers));
router.post("/office/customers/:userId/licenses", requireOfficeStaff, asOffice(createLicense));
router.put("/office/customers/:userId/licenses/:id", requireOfficeStaff, asOffice(updateLicense));
router.delete("/office/customers/:userId/licenses/:id", requireOfficeStaff, asOffice(deleteLicense));

// Customers are approved registrations plus anyone with requests from before
// registration existed (the same rule as customer access).
router.get("/office/customers", requireOfficeStaff, async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
  const match = q ? sql`and (position(lower(${q}) in lower(coalesce(r.full_name, ''))) > 0
      or position(lower(${q}) in lower(coalesce(r.email, ''))) > 0
      or position(lower(${q}) in lower(coalesce(c.name, ''))) > 0
      or position(${q} in coalesce(r.contact_phone, '')) > 0)` : sql``;
  const result = await db.execute<{
    user_id: string; full_name: string | null; email: string | null; contact_phone: string | null; company_name: string | null;
    employees: number; licenses: number; active_requests: number; expiring: number; last_activity: Date | null;
  }>(sql`
    with ids as (
      select user_id from ${hbsRegistrationRequests} where status = 'approved'
      union select user_id from ${hbsServiceRequests}
    )
    select ids.user_id, r.full_name, r.email, r.contact_phone, c.name as company_name,
      (select count(*)::int from ${hbsCompanyEmployees} e where e.user_id = ids.user_id and e.status = 'active') as employees,
      (select count(*)::int from ${hbsCompanyLicenses} l where l.user_id = ids.user_id) as licenses,
      (select count(*)::int from ${hbsServiceRequests} s where s.user_id = ids.user_id and s.status <> 'completed') as active_requests,
      (select count(*)::int from ${hbsDocumentReminders} d where d.user_id = ids.user_id
        and d.expires_on between ${riyadhToday()} and ${riyadhToday()} + 60) as expiring,
      greatest((select max(s.updated_at) from ${hbsServiceRequests} s where s.user_id = ids.user_id), r.updated_at, c.updated_at) as last_activity
    from ids
    left join ${hbsRegistrationRequests} r on r.user_id = ids.user_id
    left join ${hbsCompanies} c on c.user_id = ids.user_id
    where true ${match}
    order by last_activity desc nulls last
    limit 200`);
  const items = result.rows.map(row => ({
    userId: row.user_id,
    customer: officeCustomer(row.full_name, row.email),
    contactPhone: row.contact_phone,
    companyName: row.company_name,
    employees: row.employees, licenses: row.licenses, activeRequests: row.active_requests, expiringSoon: row.expiring,
    lastActivityAt: row.last_activity ? new Date(row.last_activity) : null,
  }));
  res.json(ListOfficeCustomersResponse.parse(items));
});

router.get("/office/customers/:userId", requireOfficeStaff, async (req, res): Promise<void> => {
  const scope = await officeScope(req, res);
  if (!scope) return;
  const [file, [registration], requests, reminders] = await Promise.all([
    companyFile(scope.owner),
    db.select().from(hbsRegistrationRequests).where(eq(hbsRegistrationRequests.userId, scope.owner)).limit(1),
    db.select().from(hbsServiceRequests).where(eq(hbsServiceRequests.userId, scope.owner))
      .orderBy(desc(hbsServiceRequests.createdAt), desc(hbsServiceRequests.id)).limit(100),
    db.select().from(hbsDocumentReminders).where(eq(hbsDocumentReminders.userId, scope.owner))
      .orderBy(asc(hbsDocumentReminders.expiresOn), asc(hbsDocumentReminders.id)),
  ]);
  const labels = await subjectLabels(
    requests.flatMap(r => r.employeeId ? [r.employeeId] : []), requests.flatMap(r => r.licenseId ? [r.licenseId] : []));
  send(res, 200, GetOfficeCustomerFileResponse, {
    userId: scope.owner,
    customer: officeCustomer(registration?.fullName ?? null, registration?.email ?? null),
    contactPhone: registration?.contactPhone ?? null,
    ...file,
    requests: requests.map(r => ({
      id: r.id, reference: requestReference(r.id, r.createdAt), service: r.service, status: r.status, createdAt: r.createdAt,
      subject: subjectOf(r, labels),
    })),
    reminders: reminders.map(row => ({
      id: row.id, kind: row.kind, label: row.label, expiresOn: row.expiresOn, note: row.note,
      addedBy: row.createdBy === row.userId ? "customer" : "office", createdAt: row.createdAt,
      source: row.employeeId ? "employee" : row.licenseId ? "license" : "manual",
      sourceId: row.employeeId ?? row.licenseId ?? null,
    })),
  });
});

export default router;
