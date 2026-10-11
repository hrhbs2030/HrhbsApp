// The moves a request may make between statuses. The office picks a status
// from a list, so a wrong click (completed back to received, say) must be
// refused by the server, not just hidden in the form.
export const REQUEST_STATUSES = [
  "received", "reviewing", "waiting_on_customer", "submitted_to_authority", "awaiting_payment", "completed",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const transitions: Record<RequestStatus, readonly RequestStatus[]> = {
  received: ["reviewing", "waiting_on_customer", "awaiting_payment"],
  reviewing: ["waiting_on_customer", "awaiting_payment", "submitted_to_authority", "completed"],
  waiting_on_customer: ["reviewing"],
  // Leaving awaiting_payment also needs every invoice settled or cancelled (checked against the database).
  awaiting_payment: ["reviewing", "submitted_to_authority"],
  submitted_to_authority: ["completed", "reviewing"],
  // A completed request can only be reopened for review.
  completed: ["reviewing"],
};

export const requestStatusLabels: Record<RequestStatus, string> = {
  received: "تم الاستلام",
  reviewing: "قيد المراجعة",
  waiting_on_customer: "بانتظار العميل",
  submitted_to_authority: "تم الرفع للجهة المختصة",
  awaiting_payment: "بانتظار السداد",
  completed: "مكتملة",
};

export function isRequestStatus(value: string): value is RequestStatus {
  return (REQUEST_STATUSES as readonly string[]).includes(value);
}

export function allowedNext(from: string): readonly RequestStatus[] {
  return isRequestStatus(from) ? transitions[from] : [];
}

// Staying in the same status is always fine: the office edits notes,
// assignees and dates without moving the request.
export function canTransition(from: string, to: string): boolean {
  return from === to || allowedNext(from).includes(to as RequestStatus);
}

// Statuses that may not be entered or left while an invoice is still issued.
export function needsInvoicesSettled(from: string, to: string): boolean {
  return from !== to && (to === "completed" || from === "awaiting_payment");
}

export function transitionError(from: string, to: string): string {
  const label = (status: string) => (isRequestStatus(status) ? requestStatusLabels[status] : status);
  return `لا يمكن نقل الطلب من ${label(from)} إلى ${label(to)}.`;
}
export const UNPAID_INVOICE_ERROR = "لا يمكن إكمال الطلب وله فاتورة غير مسددة.";
export const UNPAID_INVOICE_MOVE_ERROR = "لا يمكن نقل الطلب وله فاتورة غير مسددة.";
