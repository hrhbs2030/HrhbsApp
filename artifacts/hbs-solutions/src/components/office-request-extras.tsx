import { useEffect, useState } from 'react';
import { ScanText } from 'lucide-react';
import { useCreateOfficeReminder, useExtractOfficeAttachmentDocument, type ServiceAttachment } from '@workspace/api-client-react';
import { ReminderForm, emptyDraft, type Draft } from '@/components/reminder-ui';

// Office: read a customer's document with AI, check the result, then save it
// as a renewal reminder on the customer's account. Nothing is saved until
// staff confirm, and every reading is recorded in the audit log.
export function ExtractReminder({ requestId, file, onClose }: { requestId: number; file: ServiceAttachment | null; onClose: () => void }) {
  const extract = useExtractOfficeAttachmentDocument();
  const create = useCreateOfficeReminder();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileId = file?.id ?? null;
  useEffect(() => {
    if (fileId === null) return;
    let current = true;
    setDraft(null); setHint(null); setError(null); setSaved(false);
    extract.mutateAsync({ attachmentId: fileId }).then(result => {
      if (!current) return;
      setDraft({ kind: result.kind ?? 'other', label: result.label ?? '', expiresOn: typeof result.expiresOn === 'string' ? result.expiresOn.slice(0, 10) : '', note: '' });
      setHint([result.expiresOnText && `التاريخ كما في المستند: ${result.expiresOnText}`, result.notes].filter(Boolean).join(' · ') || null);
    }).catch(() => {
      if (!current) return;
      setDraft({ ...emptyDraft });
      setHint('تعذّرت القراءة الآلية. أدخل البيانات يدويًا من المستند.');
    });
    return () => { current = false; };
  }, [fileId]);
  if (!file) return null;
  async function save(value: Draft) {
    setError(null);
    try {
      await create.mutateAsync({ id: requestId, data: { kind: value.kind, label: value.label, expiresOn: value.expiresOn, note: value.note || null } });
      setSaved(true);
    } catch { setError('تعذّر حفظ التنبيه. تحقق من البيانات.'); }
  }
  return <section className="rounded-xl border border-sage-2 bg-paper p-4" aria-label="إضافة تنبيه انتهاء من مستند">
    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><ScanText size={16} aria-hidden="true"/>تنبيه انتهاء من «{file.name}»</h3>
    {saved ? <div className="space-y-3"><p role="status" className="text-sm font-bold text-ok">حُفظ التنبيه، ويصل للعميل قبل الانتهاء.</p><button type="button" className="btn btn-outline btn-sm" onClick={onClose}>إغلاق</button></div>
      : !draft ? <p className="text-sm text-subtle" aria-live="polite">جارٍ قراءة المستند…</p>
      : <>{hint && <p className="mb-3 rounded-lg bg-sunk p-3 text-xs leading-6 text-quiet">{hint}</p>}
        <p className="mb-3 text-xs text-subtle">راجع البيانات مع المستند قبل الحفظ.</p>
        <ReminderForm initial={draft} busy={create.isPending} error={error} submitLabel="حفظ التنبيه للعميل" onSubmit={save} onCancel={onClose}/></>}
  </section>;
}
