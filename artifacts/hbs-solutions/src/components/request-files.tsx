import { useRef, useState, type ChangeEvent } from 'react';
import { Download, FileImage, FileText, Paperclip, Trash2, X } from 'lucide-react';
import {
  attachOfficeServiceRequestFiles,
  attachServiceRequestFiles,
  deleteOfficeServiceRequestFile,
  deleteServiceRequestFile,
  downloadOfficeServiceAttachment,
  downloadServiceAttachment,
  requestOfficeServiceAttachmentUpload,
  requestServiceAttachmentUpload,
  type AttachmentUploadInputContentType,
  type ServiceAttachment,
} from '@workspace/api-client-react';
import { formatDateTime, formatNumber } from '@/lib/format';
import './request-files.css';

// Documents on a request, for the customer's request page and the office
// request panel. Uploads go straight to private storage through a short-lived
// signed URL (reserve → PUT → attach); the server checks each file before it
// is attached. Limits mirror artifacts/api-server/src/routes/portal.ts.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 10;
export const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
export const RETENTION_NOTE = 'PDF أو صور JPG وPNG، حتى 10 ميغابايت للملف و10 ملفات للطلب. تُحذف الملفات تلقائيًا بعد 90 يومًا من اكتمال الطلب.';

type Scope = 'customer' | 'office';

export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} ك.ب`;
  return `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} م.ب`;
}

// The declared type the server expects; the file's bytes are checked there too.
function typeOf(file: File): AttachmentUploadInputContentType | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'application/pdf';
  if (file.type === 'image/png' || name.endsWith('.png')) return 'image/png';
  if (file.type === 'image/jpeg' || /\.jpe?g$/.test(name)) return 'image/jpeg';
  return null;
}

// Checks a picked file before anything is sent; returns an Arabic reason or null.
export function checkFile(file: File): string | null {
  if (!typeOf(file)) return `«${file.name}»: يُقبل PDF أو صور JPG وPNG فقط.`;
  if (file.size === 0) return `«${file.name}»: الملف فارغ.`;
  if (file.size > MAX_FILE_BYTES) return `«${file.name}»: أكبر من 10 ميغابايت.`;
  return null;
}

// Reserves and uploads one file; returns the reservation id to attach.
export async function uploadFile(scope: Scope, file: File): Promise<number> {
  const input = { name: file.name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 160), size: file.size, contentType: typeOf(file)! };
  const { attachmentId, uploadURL } = scope === 'office'
    ? await requestOfficeServiceAttachmentUpload(input)
    : await requestServiceAttachmentUpload(input);
  const put = await fetch(uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': input.contentType } });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return attachmentId;
}

export function uploadError(error: unknown, name: string): string {
  const status = (error as { status?: number })?.status;
  if (status === 409) return `«${name}»: لا يمكن إضافة ملفات أخرى لهذا الطلب.`;
  if (status === 429) return 'رفعت ملفات كثيرة خلال وقت قصير. انتظر قليلًا ثم حاول.';
  return `«${name}»: تعذّر رفع الملف. تحقق من الملف وحاول مرة أخرى.`;
}

export function RequestFiles({ scope, requestId, attachments, canUpload, onChanged }: {
  scope: Scope;
  requestId: number;
  attachments: ServiceAttachment[];
  canUpload: boolean;
  onChanged: () => void | Promise<unknown>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const room = MAX_FILES - attachments.length;

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!picked.length) return;
    const problems: string[] = [];
    const valid = picked.filter((file) => { const p = checkFile(file); if (p) problems.push(p); return !p; });
    if (valid.length > room) problems.push(`يمكن إضافة ${formatNumber(Math.max(room, 0))} ملفات أخرى فقط لهذا الطلب.`);
    const queue = valid.slice(0, Math.max(room, 0));
    setErrors(problems);
    setUploading(queue.map((f) => f.name));
    for (const file of queue) {
      try {
        const id = await uploadFile(scope, file);
        if (scope === 'office') await attachOfficeServiceRequestFiles(requestId, { attachmentIds: [id] });
        else await attachServiceRequestFiles(requestId, { attachmentIds: [id] });
      } catch (error) {
        problems.push(uploadError(error, file.name));
        setErrors([...problems]);
      }
      setUploading((names) => names.slice(1));
      await onChanged();
    }
  }

  async function download(file: ServiceAttachment) {
    setBusy(file.id);
    try {
      const options = { responseType: 'blob' as const };
      const blob = scope === 'office'
        ? await downloadOfficeServiceAttachment(file.id, options)
        : await downloadServiceAttachment(file.id, options);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = file.name;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setErrors([`«${file.name}»: تعذّر تنزيل الملف.`]);
    } finally { setBusy(null); }
  }

  async function remove(file: ServiceAttachment) {
    setBusy(file.id);
    try {
      if (scope === 'office') await deleteOfficeServiceRequestFile(file.id);
      else await deleteServiceRequestFile(file.id);
      await onChanged();
    } catch {
      setErrors([`«${file.name}»: تعذّر حذف الملف.`]);
    } finally { setBusy(null); setConfirming(null); }
  }

  const who = (file: ServiceAttachment) => file.uploadedBy === 'office' ? 'المكتب' : scope === 'office' ? 'العميل' : 'أنت';
  const mayDelete = (file: ServiceAttachment) => scope === 'office' || (file.uploadedBy === 'customer' && canUpload);
  const newestFirst = [...attachments].reverse();

  return (
    <section className="rf" aria-labelledby={`rf-title-${requestId}`}>
      <div className="rf-head">
        <h2 id={`rf-title-${requestId}`} className="rf-title"><Paperclip size={16} aria-hidden="true" />المستندات{attachments.length > 0 && <span className="rf-count">{formatNumber(attachments.length)}</span>}</h2>
        {canUpload && room > 0 && <>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => inputRef.current?.click()} disabled={uploading.length > 0}>
            <Paperclip size={15} aria-hidden="true" />{scope === 'office' ? 'إرفاق ملف للعميل' : 'إرفاق ملف'}
          </button>
          <input ref={inputRef} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={pick} aria-label="اختر ملفات لإرفاقها" />
        </>}
      </div>

      {attachments.length === 0 && uploading.length === 0
        ? <p className="rf-empty">{canUpload ? (scope === 'office' ? 'لا توجد مستندات. يمكنك إرفاق ملف يصل إلى العميل.' : 'لا توجد مستندات بعد. أرفق ما يطلبه المكتب.') : 'لا توجد مستندات.'}</p>
        : <ul className="rf-list">
          {uploading.map((name, index) => <li key={`up-${index}-${name}`} className="rf-row" aria-live="polite">
            <span className="rf-icon"><span className="rf-spinner" aria-hidden="true" /></span>
            <span className="rf-main"><strong>{name}</strong><small>جارٍ الرفع…</small></span>
          </li>)}
          {newestFirst.map((file) => {
            const Icon = file.contentType === 'application/pdf' ? FileText : FileImage;
            return <li key={file.id} className="rf-row">
              <span className="rf-icon"><Icon size={18} aria-hidden="true" /></span>
              <span className="rf-main">
                <strong>{file.name}</strong>
                <small>{who(file)} · {sizeText(file.size)} · <time dateTime={file.createdAt}>{formatDateTime(file.createdAt)}</time></small>
              </span>
              <span className="rf-actions">
                {confirming === file.id ? <>
                  <button type="button" className="rf-btn rf-btn--danger" onClick={() => remove(file)} disabled={busy === file.id}>تأكيد الحذف</button>
                  <button type="button" className="rf-btn" onClick={() => setConfirming(null)} aria-label="إلغاء"><X size={16} /></button>
                </> : <>
                  <button type="button" className="rf-btn" onClick={() => download(file)} disabled={busy === file.id} aria-label={`تنزيل ${file.name}`}><Download size={17} /></button>
                  {mayDelete(file) && <button type="button" className="rf-btn" onClick={() => setConfirming(file.id)} aria-label={`حذف ${file.name}`}><Trash2 size={16} /></button>}
                </>}
              </span>
            </li>;
          })}
        </ul>}

      {errors.length > 0 && <div role="alert" className="rf-errors">{errors.map((e) => <p key={e}>{e}</p>)}</div>}
      {canUpload && <p className="rf-note">{RETENTION_NOTE}{scope === 'office' && ' تنزيل الملفات وإرفاقها وحذفها يُسجَّل في سجل التدقيق.'}</p>}
    </section>
  );
}
