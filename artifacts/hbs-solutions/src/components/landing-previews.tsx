import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Bell, Building2, Check, CreditCard, FileText, Inbox, LayoutDashboard, MessageSquareText, PauseCircle, ReceiptText, Sparkles, UserRound } from 'lucide-react';
import { LogoMark } from '@/components/brand/logo';
import { milestoneLabels, milestones, pauses, type PauseKey } from '@/content/milestones';
import { assistantExamples, assistantName } from '@/content/site';
import { prefersReducedMotion } from '@/lib/motion';
import './landing-previews.css';

const ICON = 1.75;

// Illustrative data only. `stage` is a milestone index (content/milestones.ts);
// a `pause` holds the request at the review milestone with its own badge.
type DemoRequest = { ref: string; title: string; area: string; stage: number; pause?: PauseKey; updated: string };
// One establishment, the three problems: a note on the wage file (the office
// needs one document), a work-permit renewal already with the authority, and
// a completed wage update at GOSI that had shown as a mismatch between platforms.
const demoRequests: DemoRequest[] = [
  { ref: 'HBS-2026-00041', title: 'متابعة الالتزام بحماية الأجور', area: 'الموارد البشرية والعمل', stage: 1, pause: 'waiting_on_customer', updated: 'اليوم' },
  { ref: 'HBS-2026-00037', title: 'إصدار أو تجديد رخصة العمل', area: 'الموارد البشرية والعمل', stage: 2, updated: 'أمس' },
  { ref: 'HBS-2026-00029', title: 'تحديث أجر مشترك', area: 'الموارد البشرية والعمل', stage: 3, updated: '8 سبتمبر' },
];
const stageTone = ['info', 'info', 'info', 'ok'] as const;
const statusOf = (r: DemoRequest) => r.pause ? pauses[r.pause].label : milestoneLabels[r.stage];
const toneOf = (r: DemoRequest) => r.pause ? 'warn' : stageTone[r.stage];

export function DashboardPreview() {
  const [selected, setSelected] = useState(0);
  const current = demoRequests[selected];
  const waiting = demoRequests.find((r) => r.pause === 'waiting_on_customer');

  return (
    <figure className="dp" aria-label="معاينة توضيحية للوحة العميل ببيانات غير حقيقية">
      <div className="dp-chrome" aria-hidden="true">
        <span /><span /><span />
        <p dir="ltr">hrhbs.com/dashboard</p>
      </div>
      <div className="dp-demo-tag">بيانات توضيحية</div>
      <div className="dp-app">
        <aside className="dp-side" aria-hidden="true">
          <div className="dp-brand"><LogoMark size={28} /><strong>حلول الغد</strong></div>
          <ul>
            <li data-active="true"><LayoutDashboard size={16} strokeWidth={ICON} />نظرة عامة</li>
            <li><Inbox size={16} strokeWidth={ICON} />طلباتي</li>
            <li><MessageSquareText size={16} strokeWidth={ICON} />استفساراتي</li>
          </ul>
          <div className="dp-user"><UserRound size={16} strokeWidth={ICON} />شركة مثال للتجارة</div>
        </aside>

        <div className="dp-main">
          <div className="dp-top">
            <div>
              <p className="dp-eyebrow">نظرة عامة</p>
              <p className="dp-hello">مرحبًا، شركة مثال</p>
            </div>
            <span className="dp-new">طلب جديد</span>
          </div>

          {waiting && (
            <button type="button" className="dp-alert" onClick={() => setSelected(demoRequests.indexOf(waiting))}>
              <Bell size={17} strokeWidth={ICON} aria-hidden="true" />
              <span><strong>المكتب يحتاج مستندًا منك</strong> لطلب {waiting.title}</span>
              <ArrowLeft size={15} strokeWidth={ICON} aria-hidden="true" />
            </button>
          )}

          <div className="dp-grid">
            <section className="dp-card dp-requests" aria-label="الطلبات (مثال)">
              <h3 className="dp-card-title">الطلبات</h3>
              <ul>
                {demoRequests.map((r, index) => (
                  <li key={r.ref}>
                    <button type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>
                      <span className="dp-req-main">
                        <strong>{r.title}</strong>
                        <small dir="ltr">{r.ref}</small>
                      </span>
                      <span className={`dp-pill dp-pill--${toneOf(r)}`}>{statusOf(r)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="dp-card dp-detail" aria-live="polite" aria-label="تفاصيل الطلب المحدد (مثال)">
              <p className="dp-detail-ref" dir="ltr">{current.ref}</p>
              <h3 className="dp-card-title">{current.title}</h3>
              <p className="dp-detail-area">{current.area} · آخر تحديث {current.updated}</p>
              <ol className="dp-track">
                {milestoneLabels.map((label, index) => (
                  <li key={label} data-state={index < current.stage ? 'done' : index === current.stage ? 'current' : 'next'}>
                    <span aria-hidden="true">{index < current.stage || (index === milestones.length - 1 && current.stage === index) ? <Check size={10} strokeWidth={3} /> : null}</span>
                    {label}
                    {current.pause && index === current.stage && <em className="dp-pause"><PauseCircle size={12} strokeWidth={2.2} aria-hidden="true" />{pauses[current.pause].label}</em>}
                  </li>
                ))}
              </ol>
            </section>

            <section className="dp-card dp-mini" aria-label="الرسائل (مثال)">
              <h3 className="dp-card-title"><MessageSquareText size={16} strokeWidth={ICON} aria-hidden="true" />الرسائل</h3>
              <div className="dp-msg dp-msg--office">
                <span><Building2 size={13} strokeWidth={ICON} aria-hidden="true" />المكتب</span>
                <p>سبب الملاحظة: أجر موظف واحد في ملف الشهر الماضي يختلف عن عقده الموثق. أرفق كشف رواتب الشهر لنعدّ التصحيح.</p>
              </div>
              <div className="dp-msg dp-msg--me"><p>أرفقت الكشف الآن.</p></div>
            </section>

            <section className="dp-card dp-mini" aria-label="المستندات المطلوبة (مثال)">
              <h3 className="dp-card-title"><FileText size={16} strokeWidth={ICON} aria-hidden="true" />المستندات المطلوبة</h3>
              <ul className="dp-docs">
                <li data-done="true"><Check size={12} strokeWidth={3} aria-hidden="true" />صورة الملاحظة كما ظهرت في مُدد</li>
                <li><span aria-hidden="true" />كشف رواتب الشهر الماضي</li>
              </ul>
              <p className="dp-soon">ترفعها من صفحة الطلب، ويصل تنبيه إلى المكتب، وتعود الحالة إلى «قيد المراجعة».</p>
            </section>

            <section className="dp-card dp-mini" aria-label="الفواتير (مثال)">
              <h3 className="dp-card-title"><ReceiptText size={16} strokeWidth={ICON} aria-hidden="true" />الفواتير</h3>
              <div className="dp-invoice">
                <span className="dp-invoice-main"><strong dir="ltr">INV-2026-00012</strong><small>أتعاب الخدمة · {current.title}</small></span>
                <span className="dp-invoice-amount nums" dir="ltr">230.00 ر.س</span>
                <span className="dp-pill dp-pill--warn">غير مسددة</span>
                <button type="button" className="dp-pay" disabled aria-disabled="true" title="مثال توضيحي"><CreditCard size={14} strokeWidth={ICON} aria-hidden="true" />ادفع الآن</button>
              </div>
              <p className="dp-soon">تسدّد الفاتورة إلكترونيًا من صفحة الطلب، أو في المكتب.</p>
            </section>
          </div>
        </div>
      </div>
    </figure>
  );
}

// Public examples are pre-written. The live assistant requires sign-in.
export function AssistantShowcase() {
  const [active, setActive] = useState(0);
  const [typing, setTyping] = useState(false);
  const timer = useRef(0);
  const example = assistantExamples[active];

  function ask(index: number) {
    if (index === active && !typing) return;
    setActive(index);
    if (prefersReducedMotion()) { setTyping(false); return; }
    setTyping(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setTyping(false), 850);
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div className="as-grid">
      <div className="as-copy">
        <p className="as-kicker"><Sparkles size={16} strokeWidth={ICON} aria-hidden="true" />المساعدة الآلية</p>
        <h2 id="assistant-title" className="lp-heading lp-heading--dark">اسأل «{assistantName}»</h2>
        <p className="as-lead">تسألها ماذا ترسل عند ملاحظة أو تغيّر في المؤشر، وماذا تعني كل حالة في طلبك، من داخل حسابك.</p>
        <dl className="as-split">
          <div>
            <dt><Sparkles size={16} strokeWidth={ICON} aria-hidden="true" />{assistantName}</dt>
            <dd>ترشدك إلى الخدمة المناسبة وما تكتبه في طلبك. لا ترى طلباتك ولا تنفّذ أي معاملة ولا تعالج ملاحظة.</dd>
          </div>
          <div>
            <dt><Building2 size={16} strokeWidth={ICON} aria-hidden="true" />فريق المكتب</dt>
            <dd>يحدد سبب الملاحظة، ويعدّ التصحيح، ويتابع مع الجهة المختصة، ويكتب لك في محادثة الطلب.</dd>
          </div>
        </dl>
        <Link href="/sign-in" className="btn btn-light lp-btn-lg">اسألها من حسابك <ArrowLeft size={18} strokeWidth={ICON} aria-hidden="true" /></Link>
      </div>

      <figure className="as-chat" aria-label={`أمثلة على أسئلة لـ${assistantName}`}>
        <div className="as-chat-head">
          <span className="as-avatar" aria-hidden="true"><Sparkles size={18} strokeWidth={ICON} /></span>
          <div>
            <strong>{assistantName}</strong>
            <small>مساعدة آلية · إرشاد فقط</small>
          </div>
          <span className="as-demo">مثال توضيحي</span>
        </div>
        <div className="as-thread" aria-live="polite">
          <p className="as-bubble as-bubble--me" key={`q${active}`}>{example.question}</p>
          {typing
            ? <p className="as-bubble as-bubble--ai as-typing" aria-label="تكتب الآن"><i /><i /><i /></p>
            : <p className="as-bubble as-bubble--ai" key={`a${active}`}>{example.answer}</p>}
        </div>
        <div className="as-chips" role="group" aria-label="اختر سؤالًا">
          {assistantExamples.map((item, index) => (
            <button key={item.question} type="button" aria-pressed={index === active} onClick={() => ask(index)}>{item.question}</button>
          ))}
        </div>
        <figcaption>الإجابات هنا أمثلة مكتوبة مسبقًا. لا تكتب كلمات مرور أو أرقام هوية في أسئلتك.</figcaption>
      </figure>
    </div>
  );
}