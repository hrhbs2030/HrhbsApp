import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Bell, Building2, Check, FileText, Inbox, LayoutDashboard, MessageSquareText, ReceiptText, Sparkles, UserRound } from 'lucide-react';
import { LogoMark } from '@/components/brand/logo';
import { stageLabels } from '@/components/request-object';
import { assistantExamples, assistantName } from '@/content/site';
import { prefersReducedMotion } from '@/lib/motion';
import './landing-previews.css';

const ICON = 1.75;

// ---------------------------------------------------------------------------
// Client dashboard preview. Demo data only, labelled as such on screen.
// Documents and invoices are drawn because customers ask about them, but each
// is marked as not available in the portal today: the preview must not
// promise features the product does not have.
// ---------------------------------------------------------------------------

const demoRequests = [
  { ref: 'HBS-2026-00041', title: 'تجديد إقامة', area: 'الجوازات والإقامة', stage: 2, updated: 'اليوم' },
  { ref: 'HBS-2026-00037', title: 'تعديل نشاط السجل التجاري', area: 'تأسيس الشركات والتراخيص', stage: 1, updated: 'أمس' },
  { ref: 'HBS-2026-00029', title: 'نقل خدمات عامل', area: 'الموارد البشرية والعمل', stage: 3, updated: '8 سبتمبر' },
];
const stageTone = ['info', 'info', 'warn', 'ok'] as const;

export function DashboardPreview() {
  const [selected, setSelected] = useState(0);
  const current = demoRequests[selected];
  const waiting = demoRequests.find((r) => r.stage === 2);

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
              <span><strong>المكتب يحتاج ردّك</strong> على طلب {waiting.title}</span>
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
                      <span className={`dp-pill dp-pill--${stageTone[r.stage]}`}>{stageLabels[r.stage]}</span>
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
                {stageLabels.map((label, index) => (
                  <li key={label} data-state={index < current.stage ? 'done' : index === current.stage ? 'current' : 'next'}>
                    <span aria-hidden="true">{index < current.stage || (index === 3 && current.stage === 3) ? <Check size={10} strokeWidth={3} /> : null}</span>
                    {label}
                  </li>
                ))}
              </ol>
            </section>

            <section className="dp-card dp-mini" aria-label="الرسائل (مثال)">
              <h3 className="dp-card-title"><MessageSquareText size={16} strokeWidth={ICON} aria-hidden="true" />الرسائل</h3>
              <div className="dp-msg dp-msg--office">
                <span><Building2 size={13} strokeWidth={ICON} aria-hidden="true" />المكتب</span>
                <p>نحتاج تاريخ انتهاء الإقامة الحالي لإكمال طلب التجديد.</p>
              </div>
              <div className="dp-msg dp-msg--me"><p>تنتهي في 2 نوفمبر.</p></div>
            </section>

            <section className="dp-card dp-mini" aria-label="المستندات المطلوبة (مثال)">
              <h3 className="dp-card-title"><FileText size={16} strokeWidth={ICON} aria-hidden="true" />المستندات المطلوبة</h3>
              <ul className="dp-docs">
                <li data-done="true"><Check size={12} strokeWidth={3} aria-hidden="true" />صورة الجواز</li>
                <li><span aria-hidden="true" />تاريخ انتهاء الإقامة</li>
              </ul>
              <p className="dp-soon">رفع الملفات غير متاح حاليًا؛ يطلب المكتب ما يلزم عبر الرسائل.</p>
            </section>

            <section className="dp-card dp-mini" aria-label="الفواتير (مثال)">
              <h3 className="dp-card-title"><ReceiptText size={16} strokeWidth={ICON} aria-hidden="true" />الفواتير</h3>
              <div className="dp-ghost" aria-hidden="true"><i /><i /><i /></div>
              <p className="dp-soon">غير متاحة في البوابة حاليًا.</p>
            </section>
          </div>
        </div>
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// «أم مشعل»: example exchanges. Answers are pre-written from the facts the
// live assistant is given; nothing is sent to a server from the landing page.
// ---------------------------------------------------------------------------

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
        <p className="as-lead">إجابات فورية عن استخدام البوابة ومعنى كل حالة، في أي وقت ومن داخل حسابك.</p>
        <dl className="as-split">
          <div>
            <dt><Sparkles size={16} strokeWidth={ICON} aria-hidden="true" />{assistantName}</dt>
            <dd>ترشدك وتشرح الخطوات. لا ترى طلباتك ولا تنفّذ أي معاملة.</dd>
          </div>
          <div>
            <dt><Building2 size={16} strokeWidth={ICON} aria-hidden="true" />فريق المكتب</dt>
            <dd>يراجع طلبك وينفّذ المعاملة ويردّ على استفسارك ردًا رسميًا.</dd>
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
