import { useRef, useState, type ChangeEvent } from 'react';
import { Camera, Check, Circle, Download, FileImage, FileText, ListChecks, Paperclip, ScanText, Trash2, Upload, X } from 'lucide-react';
import {
  attachOfficeServiceRequestFiles,
  attachServiceRequestFiles,
  deleteOfficeServiceRequestFile,
  deleteServiceRequestFile,
  downloadOfficeServiceAttachment,
  downloadServiceAttachment,
  linkAttachmentToChecklist,
  linkOfficeAttachmentToChecklist,
  requestOfficeServiceAttachmentUpload,
  requestServiceAttachmentUpload,
  type AttachmentUploadInputContentType,
  type ChecklistItem,
  type ServiceAttachment,
} from '@workspace/api-client-react';
import { formatDateTime, formatNumber } from '@/lib/format';
import { compressImage } from '@/lib/image';
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

// A picked file ready to upload; `originalSize` is set when a photo was compressed.
export type Prepared = { file: File; originalSize: number | null };

// Type check, then photo compression, then the size limit on what will be sent:
// a 6 MB camera shot becomes a ~1 MB JPEG and a 12 MB one is accepted after
// shrinking. Returns Arabic problems for the files that are not usable.
export async function prepareFiles(picked: File[]): Promise<{ files: Prepared[]; problems: string[] }> {
  const files: Prepared[] = [];
  const problems: string[] = [];
  for (const original of picked) {
    const file = typeOf(original) ? await compressImage(original) : original;
    const problem = checkFile(file);
    if (problem) problems.push(problem);
    else files.push({ file, originalSize: file === original ? null : original.size });
  }
  return { files, problems };
}

// Camera capture on phones: a separate input, since `capture` on the main one
// would hide the gallery and files on some browsers.
export const CAMERA_ACCEPT = 'image/*';

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

export function RequestFiles({ scope, requestId, attachments, checklist = [], canUpload, onChanged, onExtract }: {
  scope: Scope;
  requestId: number;
  attachments: ServiceAttachment[];
  // The office's list of required documents; each links to one uploaded file.
  checklist?: ChecklistItem[];
  canUpload: boolean;
  onChanged: () => void | Promise<unknown>;
  // Office only: read a document's expiry date to add a renewal reminder.
  onExtract?: (file: ServiceAttachment) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<Prepared[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  // The checklist item the next picked file is for ("ارفع" opened the picker).
  const forKey = useRef<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const room = MAX_FILES - attachments.length;

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    const key = forKey.current; forKey.current = null;
    if (!picked.length) return;
    setErrors([]);
    setUploading(picked.map((file) => ({ file, originalSize: null })));
    const { files: valid, problems } = await prepareFiles(picked);
    if (valid.length > room) problems.push(`يمكن إضافة ${formatNumber(Math.max(room, 0))} ملفات أخرى فقط لهذا الطلب.`);
    const queue = valid.slice(0, Math.max(room, 0));
    setErrors(problems);
    setUploading(queue);
    for (const [index, { file }] of queue.entries()) {
      try {
        const id = await uploadFile(scope, file);
        // Picked for a checklist item: the first file is linked in the same call.
        const body = { attachmentIds: [id], ...(key && index === 0 ? { checklist: [{ attachmentId: id, key }] } : {}) };
        if (scope === 'office') await attachOfficeServiceRequestFiles(requestId, body);
        else await attachServiceRequestFiles(requestId, body);
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

  function pickFor(key: string) { forKey.current = key; inputRef.current?.click(); }
  async function unlink(item: ChecklistItem) {
    if (item.attachmentId === null) return;
    setLinking(item.key);
    try {
      if (scope === 'office') await linkOfficeAttachmentToChecklist(requestId, item.attachmentId, { key: null });
      else await linkAttachmentToChecklist(requestId, item.attachmentId, { key: null });
      await onChanged();
    } catch { setErrors([`«${item.label}»: تعذّر فك الربط.`]); } finally { setLinking(null); }
  }
  const linked = checklist.filter(i => i.attachmentId !== null).length;

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
          <button type="button" className="btn btn-outline btn-sm rf-camera" onClick={() => cameraRef.current?.click()} disabled={uploading.length > 0}>
            <Camera size={15} aria-hidden="true" />التقط بالكاميرا
          </button>
          <input ref={inputRef} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={pick} aria-label="اختر ملفات لإرفاقها" />
          <input ref={cameraRef} type="file" accept={CAMERA_ACCEPT} capture="environment" hidden onChange={pick} aria-label="التقط صورة للمستند" />
        </>}
      </div>

      {checklist.length > 0 && <div className="rf-check" role="group" aria-label="المستندات المطلوبة">
        <div className="rf-check-head"><ListChecks size={15} aria-hidden="true"/>المستندات المطلوبة <span className="nums">{formatNumber(linked)}/{formatNumber(checklist.length)}</span></div>
        <ul>{checklist.map(item => { const done = item.attachmentId !== null; return <li key={item.key} data-done={done || undefined}>
          <span className={`rf-check-mark ${done ? 'is-done' : ''}`} aria-hidden="true">{done ? <Check size={14} strokeWidth={3}/> : <Circle size={10}/>}</span>
          <span className="rf-check-main"><strong>{item.label}</strong>{done ? <small>{item.attachmentName}</small> : <small>{canUpload ? 'لم يُرفع بعد' : 'غير مرفوع'}</small>}</span>
          {canUpload && (done
            ? <button type="button" className="rf-btn rf-btn--text" onClick={() => unlink(item)} disabled={linking === item.key || uploading.length > 0}>فك الربط</button>
            : room > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={() => pickFor(item.key)} disabled={uploading.length > 0}><Upload size={14} aria-hidden="true"/>ارفع</button>)}
        </li>; })}</ul>
      </div>}

      {attachments.length === 0 && uploading.length === 0
        ? <p className="rf-empty">{canUpload ? (scope === 'office' ? 'لا توجد مستندات. يمكنك إرفاق ملف يصل إلى العميل.' : 'لا توجد مستندات بعد. أرفق ما يطلبه المكتب.') : 'لا توجد مستندات.'}</p>
        : <ul className="rf-list">
          {uploading.map(({ file, originalSize }, index) => <li key={`up-${index}-${file.name}`} className="rf-row" aria-live="polite">
            <span className="rf-icon"><span className="rf-spinner" aria-hidden="true" /></span>
            <span className="rf-main"><strong>{file.name}</strong><small>جارٍ الرفع… · {sizeText(file.size)}{originalSize !== null && ` (ضُغطت من ${sizeText(originalSize)})`}</small></span>
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
                  {onExtract && <button type="button" className="rf-btn" onClick={() => onExtract(file)} aria-label={`قراءة تاريخ انتهاء ${file.name} وإضافة تنبيه`} title="قراءة تاريخ الانتهاء وإضافة تنبيه"><ScanText size={17} /></button>}
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
