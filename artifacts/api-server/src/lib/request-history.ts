// A request's status history, rebuilt from data already stored: it starts
// "received" when created, and each office update in the audit log records
// { fromStatus, toStatus }. No extra table or migration is needed.

export type RequestStatus = "received" | "reviewing" | "waiting_on_customer" | "completed";
export type StatusEvent = { status: RequestStatus; at: Date };

const statuses = new Set<string>(["received", "reviewing", "waiting_on_customer", "completed"]);

export function statusHistory(createdAt: Date, updates: { createdAt: Date; details: unknown }[]): StatusEvent[] {
  const events: StatusEvent[] = [{ status: "received", at: createdAt }];
  const ordered = [...updates].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const update of ordered) {
    const details = (update.details ?? {}) as { toStatus?: unknown };
    const to = typeof details.toStatus === "string" ? details.toStatus : null;
    if (!to || !statuses.has(to)) continue;
    // Note-only edits keep the status; record changes only.
    if (events[events.length - 1].status === to) continue;
    events.push({ status: to as RequestStatus, at: update.createdAt });
  }
  return events;
}
