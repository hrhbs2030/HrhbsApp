import { useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileImage, FileText, Paperclip, Trash2, X } from 'lucide-react';
import {
  deleteOfficeServiceRequestFile,
  deleteServiceRequestFile,
  downloadOfficeServiceRequestFile,
  downloadServiceRequestFile,
  getListOfficeServiceRequestFilesQueryKey,
  getListServiceRequestFilesQueryKey,
  uploadOfficeServiceRequestFile,
  uploadServiceRequestFile,
  useListOfficeServiceRequestFiles,
  useListServiceRequestFiles,
  type RequestFile,
} from '@workspace/api-client-react';
import { formatDateTime, formatNumber } from '@/lib/format';
import './request-files.css';

// Documents on a request: the customer's page and the office request panel
// share this component. `scope` picks the API (customer or office routes).
// Limits and types mirror the server (artifacts/api-server/src/lib/request-files.ts).

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 10;
export const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
export const RETENTION_NOTE = 'PDF أو صور JPG وPNG، حتى 10 ميغابايت للملف و10 ملفات للطلب. تُحذف الملفات تلقائيًا بعد 90 يومًا من اكتمال الطلب.';

type Scope = 'customer' | 'office';

export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} ك.ب`;
  return `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} م.ب`;
}

// Checks a picked file before it is sent; returns an Arabic reason or null.
export function checkFile(file: File): string | null {
  const byName = /\.(pdf|jpe?g|png)$/i.test(file.name);
  if (!ACCEPTED_TYPES.includes(file.type) && !byName) return `«${file.name}»: يُقبل PDF أو صور JPG وPNG فقط.`;
  if (file.size === 0) return `«${file.name}»: الملف فارغ.`;
  if (file.size > MAX_FILE_BYTES) return `«${file.name}»: أكبر من 10 ميغابايت.`;
  return null;
}

export function uploadError(error: unknown, name: string): string {
  const status = (error as { status?: number })?.status;
  if (status === 415) return `«${name}»: نوع الملف غير مقبول. استخدم PDF أو JPG أو PNG.`;
  if (status === 413) return `«${name}»: أكبر من 10 ميغابايت.`;
  if (status === 409) return `«${name}»: لا يمكن إضافة ملفات أخرى لهذا الطلب.`;
  return `«${name}»: تعذّر رفع الملف. حاول مرة أخرى.`;
}

export async function uploadFile(scope: Scope, requestId: number, file: File): Promise<RequestFile> {
  const options = { headers: { 'X-File-Name': encodeURIComponent(file.name) } };
  return scope === 'office'
    ? uploadOfficeServiceRequestFile(requestId, file, options)
    : uploadServiceRequestFile(requestId, file, options);
}

const removedText: Record<string, string> = {
  retention: 'حُذف بعد انتهاء مدة الحفظ',
  uploader: 'حذفه صاحبه',
  office: 'حذفه المكتب',
};

export function RequestFiles({ scope, requestId, canUpload }: { scope: Scope; requestId: number; canUpload: boolean }) {
  const qc = useQueryClient();
  const customer = useListServiceRequestFiles(requestId, { query: { enabled: scope === 'customer', queryKey: getListServiceRequestFilesQueryKey(requestId) } });
  const office = useListOfficeServiceRequestFiles(requestId, { query: { enabled: scope === 'office', queryKey: getListOfficeServiceRequestFilesQueryKey(requestId) } });
  const list = scope === 'office' ? office : customer;
  const queryKey = scope === 'office' ? getListOfficeServiceRequestFilesQueryKey(requestId) : getListServiceRequestFilesQueryKey(requestId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const files = list.data ?? [];
  const active = files.filter((f) => !f.deletedAt);
  const room = MAX_FILES - active.length;

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
      try { await uploadFile(scope, requestId, file); }
      catch (error) { problems.push(uploadError(error, file.name)); setErrors([...problems]); }
      setUploading((names) => names.slice(1));
      await qc.invalidateQueries({ queryKey });
    }
  }

  async function download(file: RequestFile) {
    setBusy(file.id);
    try {
      const options = { responseType: 'blob' as const };
      const blob = scope === 'office'
        ? await downloadOfficeServiceRequestFile(requestId, file.id, options)
        : await downloadServiceRequestFile(requestId, file.id, options);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = file.fileName;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setErrors([`«${file.fileName}»: تعذّر تنزيل الملف.`]);
    } finally { setBusy(null); }
  }

  async function remove(file: RequestFile) {
    setBusy(file.id);
    try {
      if (scope === 'office') await deleteOfficeServiceRequestFile(requestId, file.id);
      else await deleteServiceRequestFile(requestId, file.id);
      await qc.invalidateQueries({ queryKey });
    } catch {
      setErrors([`«${file.fileName}»: تعذّر حذف الملف.`]);
    } finally { setBusy(null); setConfirming(null); }
  }

  const who = (file: RequestFile) => file.uploaderRole === 'office' ? 'المكتب' : scope === 'office' ? 'العميل' : 'أنت';
  const mayDelete = (file: RequestFile) => !file.deletedAt && (scope === 'office' || (file.uploaderRole === 'customer' && canUpload));

  return (
    <section className="rf" aria-labelledby={`rf-title-${requestId}`}>
      <div className="rf-head">
        <h2 id={`rf-title-${requestId}`} className="rf-title"><Paperclip size={16} aria-hidden="true" />المستندات{active.length > 0 && <span className="rf-count">{formatNumber(active.length)}</span>}</h2>
        {canUpload && room > 0 && <>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => inputRef.current?.click()} disabled={uploading.length > 0}>
            <Paperclip size={15} aria-hidden="true" />{scope === 'office' ? 'إرفاق ملف للعميل' : 'إرفاق ملف'}
          </button>
          <input ref={inputRef} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={pick} aria-label="اختر ملفات لإرفاقها" />
        </>}
      </div>

      {list.isLoading ? <p className="rf-empty">جارٍ التحميل…</p>
        : list.isError ? <p className="rf-empty">تعذّر تحميل المستندات.</p>
        : files.length === 0 && uploading.length === 0 ? <p className="rf-empty">{canUpload ? (scope === 'office' ? 'لا توجد مستندات. يمكنك إرفاق ملف يصل إلى العميل.' : 'لا توجد مستندات بعد. أرفق ما يطلبه المكتب.') : 'لا توجد مستندات.'}</p>
        : <ul className="rf-list">
          {uploading.map((name, index) => <li key={`up-${index}-${name}`} className="rf-row" data-state="uploading" aria-live="polite">
            <span className="rf-icon"><span className="rf-spinner" aria-hidden="true" /></span>
            <span className="rf-main"><strong>{name}</strong><small>جارٍ الرفع…</small></span>
          </li>)}
          {files.map((file) => {
            const Icon = file.contentType === 'application/pdf' ? FileText : FileImage;
            return <li key={file.id} className="rf-row" data-state={file.deletedAt ? 'removed' : undefined}>
              <span className="rf-icon"><Icon size={18} aria-hidden="true" /></span>
              <span className="rf-main">
                <strong>{file.fileName}</strong>
                <small>{file.deletedAt ? removedText[file.deletedReason ?? ''] ?? 'حُذف' : <>{who(file)} · {sizeText(file.sizeBytes)} · <time dateTime={file.createdAt}>{formatDateTime(file.createdAt)}</time></>}</small>
              </span>
              {!file.deletedAt && <span className="rf-actions">
                {confirming === file.id ? <>
                  <button type="button" className="rf-btn rf-btn--danger" onClick={() => remove(file)} disabled={busy === file.id}>تأكيد الحذف</button>
                  <button type="button" className="rf-btn" onClick={() => setConfirming(null)} aria-label="إلغاء"><X size={16} /></button>
                </> : <>
                  <button type="button" className="rf-btn" onClick={() => download(file)} disabled={busy === file.id} aria-label={`تنزيل ${file.fileName}`}><Download size={17} /></button>
                  {mayDelete(file) && <button type="button" className="rf-btn" onClick={() => setConfirming(file.id)} aria-label={`حذف ${file.fileName}`}><Trash2 size={16} /></button>}
                </>}
              </span>}
            </li>;
          })}
        </ul>}

      {errors.length > 0 && <div role="alert" className="rf-errors">{errors.map((e) => <p key={e}>{e}</p>)}</div>}
      {canUpload && <p className="rf-note">{RETENTION_NOTE}{scope === 'office' && ' تنزيل الملفات وإرفاقها وحذفها يُسجَّل في سجل التدقيق.'}</p>}
    </section>
  );
}
