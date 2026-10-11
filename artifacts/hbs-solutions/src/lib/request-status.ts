import type { ServiceRequestStatus } from '@workspace/api-client-react';

// Which statuses the office may move a request to from its current one. This
// mirrors the API's table so the editor offers only sensible choices; the API
// is the enforcer and answers 409 for anything else, so keep both in sync.
export const nextStatuses: Record<ServiceRequestStatus, ServiceRequestStatus[]> = {
  received: ['reviewing', 'waiting_on_customer', 'awaiting_payment'],
  reviewing: ['waiting_on_customer', 'awaiting_payment', 'submitted_to_authority', 'completed'],
  waiting_on_customer: ['reviewing'],
  awaiting_payment: ['reviewing', 'submitted_to_authority'],
  submitted_to_authority: ['completed', 'reviewing'],
  completed: ['reviewing'],
};

// The current status first (always selectable), then its allowed moves; a
// draft value from before the request changed stays visible so the select is
// never left showing nothing.
export function statusChoices(current: ServiceRequestStatus, draft?: ServiceRequestStatus): ServiceRequestStatus[] {
  const choices = [current, ...(nextStatuses[current] ?? [])];
  if (draft && !choices.includes(draft)) choices.push(draft);
  return choices;
}
