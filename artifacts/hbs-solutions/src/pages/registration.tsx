import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, Check, CheckCircle2, Clock3, Inbox, RotateCcw, UserRoundCheck, X } from 'lucide-react';
import './registration.css';
import { LOCALE } from '@/lib/format';
import { PageHeading } from '@/components/portal-ui';

export type RegistrationStatus = 'pending' | 'approved' | 'rejected';

/** The registration returned by the server. The email is never taken from editable form values. */
export interface Registration {
  id: number;
  fullName: string;
  email: string;
  contactPhone: string;
  note: string | null;
  status: RegistrationStatus;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegistrationFormValues {
  fullName: string;
  contactPhone: string;
  note: string;
}

export interface RegistrationRequestPageProps {
  /** Verified email supplied by the server for the signed-in account. */
  email: string;
  values: RegistrationFormValues;
  onChange: (field: keyof RegistrationFormValues, value: string) => void;
  /** Creates a request, or resubmits a rejected request. Parent chooses the mutation from registration.status. */
  onSubmit: (values: RegistrationFormValues) => void | Promise<void>;
  registration?: Registration | null;
  loading?: boolean;
  submitting?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export interface OfficeRegistrationsPageProps {
  registrations: Registration[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** The ID currently being approved or rejected. */
  processingId?: number | null;
  actionError?: string | null;
  /** Optional controlled filter. Defaults to all when omitted. */
  filter?: RegistrationStatus | 'all';
  onFilterChange?: (filter: RegistrationStatus | 'all') => void;
  onApprove: (id: number) => void | Promise<void>;
  onReject: (id: number, reason: string) => void | Promise<void>;
}

const statusLabels: Record<RegistrationStatus, string> = {
  pending: 'بانتظار المراجعة',
  approved: 'تمت الموافقة',
  rejected: 'لم تتم الموافقة',
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '-'
    : new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function StatusChip({ status }: { status: RegistrationStatus }) {
  return <span className={`reg-chip ${status}`} data-testid={`status-registration-${status}`}>
    {status === 'approved' ? <Check size={13} aria-hidden="true" /> : status === 'pending' ? <Clock3 size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
    {statusLabels[status]}
  </span>;
}

function LoadingRows() {
  return <div className="reg-card reg-loading" role="status" aria-label="جارٍ تحميل طلبات التسجيل">
    {[1, 2, 3].map(number => <div className="reg-loading-row" key={number}>
      <div className="reg-skeleton" style={{ width: '36%' }} />
      <div className="reg-skeleton" style={{ width: '79%' }} />
      <div className="reg-skeleton" style={{ width: '56%' }} />
    </div>)}
    <span className="sr-only">جارٍ تحميل البيانات</span>
  </div>;
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="reg-alert reg-alert-error" role="alert" data-testid="status-registration-error">
    <AlertCircle size={18} aria-hidden="true" />
    <div><p>{message}</p>{onRetry && <button className="reg-btn reg-btn-secondary reg-btn-small" style={{ marginTop: 10 }} type="button" onClick={onRetry} data-testid="button-retry-registration"><RotateCcw size={14} aria-hidden="true" />إعادة المحاولة</button>}</div>
  </div>;
}

function ProcessAside() {
  return <aside className="reg-aside" aria-label="خطوات التسجيل">
    <section className="reg-card reg-aside-card">
      <h2>خطوات التسجيل</h2>
      <ol className="reg-steps">
        <li><span className="reg-step-num">١</span><div><strong>إرسال البيانات</strong><p>الاسم ورقم التواصل.</p></div></li>
        <li><span className="reg-step-num">٢</span><div><strong>مراجعة المكتب</strong><p>يراجع فريق المكتب طلبك.</p></div></li>
        <li><span className="reg-step-num">٣</span><div><strong>القرار</strong><p>تظهر النتيجة في هذه الصفحة.</p></div></li>
      </ol>
    </section>
  </aside>;
}

/** The pending/approved state of a submitted registration, without editable controls. */
export function PendingRegistrationPage({ registration }: { registration: Registration }) {
  const approved = registration.status === 'approved';
  return <div className="registration-page" dir="rtl">
    <PageHeading eyebrow="" title="طلب التسجيل" />
    <div className="reg-grid">
      <section className="reg-card reg-status-panel" aria-labelledby="registration-status-title">
        <div className={`reg-status-mark ${approved ? 'approved' : ''}`}>{approved ? <CheckCircle2 size={27} aria-hidden="true" /> : <Clock3 size={27} aria-hidden="true" />}</div>
        <StatusChip status={registration.status} />
        <h2 id="registration-status-title">{approved ? 'تمت الموافقة على تسجيلك' : 'وصل طلبك إلى المكتب'}</h2>
        <p>{approved ? 'يمكنك الآن استخدام خدمات البوابة.' : 'طلبك قيد مراجعة المكتب، ولا حاجة لإرسال طلب آخر. تظهر النتيجة في هذه الصفحة.'}</p>
        <dl className="reg-status-details">
          <div><dt>اسم مقدم الطلب</dt><dd data-testid="text-registration-name">{registration.fullName}</dd></div>
          <div><dt>تاريخ التقديم</dt><dd data-testid="text-registration-date">{formatDate(registration.createdAt)}</dd></div>
          <div><dt>البريد الإلكتروني</dt><dd dir="ltr" style={{ textAlign: 'right' }} data-testid="text-registration-email">{registration.email}</dd></div>
          <div><dt>رقم التواصل</dt><dd dir="ltr" style={{ textAlign: 'right' }} data-testid="text-registration-phone">{registration.contactPhone}</dd></div>
        </dl>
        {approved && <Link href="/dashboard" className="reg-btn">الانتقال إلى مساحتك<ArrowLeft size={17} aria-hidden="true" /></Link>}
      </section>
      <ProcessAside />
    </div>
  </div>;
}

export function RegistrationRequestPage({ email, values, onChange, onSubmit, registration, loading = false, submitting = false, error, onRetry }: RegistrationRequestPageProps) {
  if (loading) return <div className="registration-page" dir="rtl"><PageHeading eyebrow="" title="طلب التسجيل" /><LoadingRows /></div>;
  if (error && !registration && onRetry && !email) return <div className="registration-page" dir="rtl"><PageHeading eyebrow="" title="طلب التسجيل" /><ErrorNotice message={error} onRetry={onRetry} /></div>;
  if (registration?.status === 'pending' || registration?.status === 'approved') return <div className="registration-page" dir="rtl">
    {error && <ErrorNotice message={error} onRetry={onRetry} />}
    <PendingRegistrationPage registration={registration} />
  </div>;

  const rejected = registration?.status === 'rejected';
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submitting) void onSubmit(values);
  };
  return <div className="registration-page" dir="rtl">
    <PageHeading eyebrow="" title={rejected ? 'إعادة تقديم طلب التسجيل' : 'طلب التسجيل'} subtitle={rejected ? 'راجع ملاحظة المكتب، ثم حدّث بياناتك وأعد التقديم.' : 'يراجع المكتب بياناتك قبل تفعيل خدمات البوابة لحسابك.'} />
    {error && <ErrorNotice message={error} onRetry={onRetry} />}
    {rejected && <div className="reg-alert reg-alert-rejected" role="status" data-testid="status-registration-rejected"><AlertCircle size={19} aria-hidden="true" /><div><strong>لم تتم الموافقة على الطلب السابق</strong><p>{registration.reason || 'راجع بياناتك وأعد التقديم.'}</p></div></div>}
    <div className="reg-grid">
      <section className="reg-card" aria-labelledby="registration-form-title">
        <div className="reg-card-head"><h2 id="registration-form-title">بيانات مقدم الطلب</h2></div>
        <form className="reg-form" onSubmit={submit}>
          <div className="reg-fields">
            <div className="reg-field"><label htmlFor="reg-full-name">الاسم الكامل <span aria-hidden="true">*</span></label><input className="reg-input" id="reg-full-name" name="fullName" type="text" autoComplete="name" required minLength={2} maxLength={120} value={values.fullName} onChange={event => onChange('fullName', event.target.value)} placeholder="الاسم الكامل" disabled={submitting} data-testid="input-registration-full-name" /></div>
            <div className="reg-field"><label htmlFor="reg-phone">رقم التواصل <span aria-hidden="true">*</span></label><input className="reg-input" id="reg-phone" name="contactPhone" type="tel" autoComplete="tel" inputMode="tel" required minLength={9} maxLength={24} dir="ltr" style={{ textAlign: 'right' }} value={values.contactPhone} onChange={event => onChange('contactPhone', event.target.value)} placeholder="05XXXXXXXX" disabled={submitting} data-testid="input-registration-phone" /></div>
            <div className="reg-field reg-field-wide"><label htmlFor="reg-email">البريد الإلكتروني</label><input className="reg-input" id="reg-email" name="email" type="email" autoComplete="email" dir="ltr" style={{ textAlign: 'right' }} value={email} readOnly aria-describedby="reg-email-help" data-testid="input-registration-email" /><p className="reg-help" id="reg-email-help">مرتبط بحسابك ولا يُعدَّل من هنا. إن كان غير صحيح، صحّحه من إعدادات حسابك قبل الإرسال.</p></div>
            <div className="reg-field reg-field-wide"><label htmlFor="reg-note">ملاحظة للمكتب <span className="reg-optional">(اختياري)</span></label><textarea className="reg-input" id="reg-note" name="note" maxLength={1000} value={values.note} onChange={event => onChange('note', event.target.value)} placeholder="أي معلومة تساعد المكتب في مراجعة طلبك" disabled={submitting} data-testid="input-registration-note" /></div>
          </div>
          <div className="reg-form-footer"><button className="reg-btn" type="submit" disabled={submitting || !email} data-testid="button-submit-registration">{submitting ? 'جارٍ إرسال الطلب…' : rejected ? 'إعادة تقديم الطلب' : 'إرسال طلب التسجيل'}{!submitting && <ArrowLeft size={17} aria-hidden="true" />}</button></div>
        </form>
      </section>
      <ProcessAside />
    </div>
  </div>;
}

export function OfficeRegistrationsPage({ registrations, loading = false, error, onRetry, processingId, actionError, filter = 'all', onFilterChange, onApprove, onReject }: OfficeRegistrationsPageProps) {
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const visible = filter === 'all' ? registrations : registrations.filter(registration => registration.status === filter);
  const pendingCount = registrations.filter(registration => registration.status === 'pending').length;
  const cancelRejection = () => { setRejectingId(null); setReason(''); };
  return <div className="registration-page" dir="rtl">
    <PageHeading eyebrow="" title="طلبات التسجيل" subtitle={`${pendingCount > 0 ? `بانتظار المراجعة: ${new Intl.NumberFormat(LOCALE).format(pendingCount)}.` : 'لا توجد طلبات بانتظار المراجعة.'} القرار نهائي بعد تأكيده.`} />
    {error && <ErrorNotice message={error} onRetry={onRetry} />}
    {actionError && <ErrorNotice message={actionError} />}
    {loading ? <LoadingRows /> : <section className="reg-card" aria-label="قائمة طلبات التسجيل">
      <div className="reg-office-toolbar"><strong>عدد الطلبات: <span className="reg-count">{new Intl.NumberFormat(LOCALE).format(visible.length)}</span></strong><label><span className="sr-only">تصفية حسب الحالة</span><select className="reg-filter" value={filter} onChange={event => onFilterChange?.(event.target.value as RegistrationStatus | 'all')} disabled={!onFilterChange} data-testid="select-registration-filter"><option value="all">كل الحالات</option><option value="pending">بانتظار المراجعة</option><option value="approved">تمت الموافقة</option><option value="rejected">لم تتم الموافقة</option></select></label></div>
      {visible.length === 0 ? <div className="reg-empty" role="status"><span className="reg-empty-icon"><Inbox size={27} aria-hidden="true" /></span><h2>لا توجد طلبات</h2><p>{filter === 'all' ? 'لم تصل طلبات تسجيل بعد.' : 'لا توجد طلبات بهذه الحالة. اختر حالة أخرى.'}</p></div> :
        <ul className="reg-list">{visible.map(registration => {
          const busy = processingId === registration.id;
          const rejecting = rejectingId === registration.id;
          return <li className="reg-list-item" key={registration.id} data-testid={`row-registration-${registration.id}`}>
            <div className="reg-item-top"><div><h2 data-testid={`text-registration-name-${registration.id}`}>{registration.fullName}</h2><p><span>قُدّم في {formatDate(registration.createdAt)}</span>{registration.updatedAt !== registration.createdAt && <span>حُدّث في {formatDate(registration.updatedAt)}</span>}</p></div><StatusChip status={registration.status} /></div>
            <dl className="reg-details">
              <div className="reg-detail"><dt>البريد الإلكتروني</dt><dd dir="ltr" style={{ textAlign: 'right' }} data-testid={`text-registration-email-${registration.id}`}>{registration.email}</dd></div>
              <div className="reg-detail"><dt>رقم التواصل</dt><dd dir="ltr" style={{ textAlign: 'right' }} data-testid={`text-registration-phone-${registration.id}`}>{registration.contactPhone}</dd></div>
              {registration.note && <div className="reg-detail reg-detail-wide"><dt>ملاحظة مقدم الطلب</dt><dd>{registration.note}</dd></div>}
              {registration.status === 'rejected' && <div className="reg-detail reg-detail-wide"><dt>سبب عدم الموافقة</dt><dd>{registration.reason || 'لم يُذكر سبب'}</dd></div>}
            </dl>
            {registration.status === 'pending' && <div className="reg-actions"><button className="reg-btn reg-btn-small" type="button" disabled={busy || !!processingId} onClick={() => void onApprove(registration.id)} data-testid={`button-approve-registration-${registration.id}`}><UserRoundCheck size={16} aria-hidden="true" />{busy && !rejecting ? 'جارٍ المعالجة…' : 'موافقة'}</button><button className="reg-btn reg-btn-secondary reg-btn-small" type="button" disabled={busy || (!!processingId && !rejecting)} onClick={() => { setRejectingId(registration.id); setReason(''); }} data-testid={`button-open-reject-registration-${registration.id}`}>عدم الموافقة</button></div>}
            {registration.status === 'pending' && rejecting && <div className="reg-reject-box"><label htmlFor={`reg-reason-${registration.id}`}>سبب عدم الموافقة <span aria-hidden="true">*</span></label><textarea className="reg-input" id={`reg-reason-${registration.id}`} value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} placeholder="سبب واضح يستطيع مقدم الطلب معالجته" disabled={busy} required data-testid={`input-rejection-reason-${registration.id}`} /><p>يظهر السبب لمقدم الطلب ليحدّث بياناته ويعيد التقديم.</p><div className="reg-actions"><button className="reg-btn reg-btn-danger reg-btn-small" type="button" disabled={busy || !reason.trim()} onClick={() => { if (reason.trim()) void onReject(registration.id, reason.trim()); }} data-testid={`button-confirm-reject-registration-${registration.id}`}>{busy ? 'جارٍ المعالجة…' : 'تأكيد عدم الموافقة'}</button><button className="reg-btn reg-btn-secondary reg-btn-small" type="button" onClick={cancelRejection} disabled={busy} data-testid={`button-cancel-reject-registration-${registration.id}`}>إلغاء</button></div></div>}
          </li>;
        })}</ul>}
    </section>}
  </div>;
}