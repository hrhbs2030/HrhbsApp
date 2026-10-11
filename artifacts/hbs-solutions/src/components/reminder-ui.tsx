import { useState, type FormEvent } from 'react';
import type { ReminderKind } from '@workspace/api-client-react';
import { daysLabel, daysUntil } from '@/lib/format';

// Shared by the customer's document reminders and the office request panel.
export const reminderKindNames: Record<ReminderKind, string> = {
  iqama: 'الإقامة', passport: 'الجواز', commercial_register: 'السجل التجاري', work_permit: 'رخصة العمل', other: 'وثيقة أخرى',
};

export function ExpiryBadge({ expiresOn }: { expiresOn: string }) {
  const days = daysUntil(expiresOn);
  const tone = days < 0 ? 'bg-danger-soft text-danger' : days <= 30 ? 'bg-warn-soft text-warn' : 'bg-sage text-teal';
  const label = days < 0 ? 'منتهية' : days === 0 ? 'تنتهي اليوم' : `بعد ${daysLabel(days)}`;
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-bold ${tone}`}>{label}</span>;
}

export type Draft = { kind: ReminderKind; label: string; expiresOn: string; note: string };
export const emptyDraft: Draft = { kind: 'iqama', label: '', expiresOn: '', note: '' };

export function ReminderForm({ initial, busy, error, onSubmit, onCancel, submitLabel }: {
  initial: Draft; busy: boolean; error: string | null; submitLabel: string;
  onSubmit: (draft: Draft) => void; onCancel: () => void;
}) {
  // The form keeps its own state; callers remount it (key) for another item.
  const [draft, setDraft] = useState(initial);
  function submit(e: FormEvent) { e.preventDefault(); onSubmit({ ...draft, label: draft.label.trim(), note: draft.note.trim() }); }
  return <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
    <label className="form-field">نوع الوثيقة<select className="form-control" value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as ReminderKind })}>
      {Object.entries(reminderKindNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    <label className="form-field">لمن هذه الوثيقة؟<input className="form-control" value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} minLength={2} maxLength={120} required placeholder="اسم صاحبها أو اسم المنشأة"/></label>
    <label className="form-field">تاريخ الانتهاء (ميلادي)<input className="form-control" type="date" dir="ltr" value={draft.expiresOn} onChange={e => setDraft({ ...draft, expiresOn: e.target.value })} required/></label>
    <label className="form-field">ملاحظة (اختياري)<input className="form-control" value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} maxLength={500}/></label>
    <p className="muted text-xs leading-6 md:col-span-2">لا تكتب رقم الهوية أو رقم الجواز. يكفي الاسم وتاريخ الانتهاء.</p>
    {error && <p role="alert" className="text-sm text-danger md:col-span-2">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2 md:col-span-2"><button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>إلغاء</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : submitLabel}</button></div>
  </form>;
}

