import type { Reminder } from '@workspace/api-client-react';
import { reminderKindNames } from '@/components/reminder-ui';

// Renewal request for a reminder: the matching service, linked to the
// employee or licence it came from, so the form opens prefilled wherever the
// reminder is shown (dashboard, documents page, company file).
const renewalServices: Record<string, string> = { iqama: 'iqama-renewal', passport: 'passport-info-update', work_permit: 'work-permit' };
export function renewalLink(r: Pick<Reminder, 'kind' | 'source' | 'sourceId'>): string {
  const params = new URLSearchParams();
  if (renewalServices[r.kind]) params.set('service', renewalServices[r.kind]);
  else { params.set('category', r.kind === 'commercial_register' ? 'business' : 'other'); params.set('name', `تجديد ${reminderKindNames[r.kind] ?? r.kind}`); }
  if (r.source !== 'manual' && r.sourceId) params.set(r.source, String(r.sourceId));
  return `/requests/new?${params}`;
}
