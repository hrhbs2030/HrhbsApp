import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, BookUser, BriefcaseBusiness, Building2, Menu, Shapes, X } from 'lucide-react';
import { Brand, statusNames, statusOptions } from '@/components/portal-ui';
import './landing.css';

const ICON_STROKE = 1.75;

const navigation = [
  { href: '#how', label: 'كيف تعمل البوابة' },
  { href: '#services', label: 'مجالات الخدمات' },
  { href: '#questions', label: 'الأسئلة الشائعة' },
];

const steps = [
  { title: 'أنشئ حسابك وقدّم طلب التسجيل', text: 'سجّل بالبريد الإلكتروني وأكّده، ثم أرسل بياناتك ليراجعها المكتب.' },
  { title: 'أرسل طلب الخدمة', text: 'بعد الموافقة، اختر المجال واكتب الخدمة المطلوبة وتفاصيلها ورقمًا للتواصل.' },
  { title: 'تابع حالة الطلب', text: 'يحدّث المكتب حالة طلبك، وتجدها مع رقمك المرجعي وتفاصيل الطلب في حسابك.' },
  { title: 'اسأل المكتب', text: 'أرسل استفسارًا من حسابك، واقرأ رد المكتب في المكان نفسه.' },
];

const serviceAreas = [
  { name: 'الجوازات', icon: BookUser, tone: 'deep' },
  { name: 'العمل', icon: BriefcaseBusiness, tone: 'accent' },
  { name: 'الأعمال', icon: Building2, tone: 'sage' },
  { name: 'خدمات أخرى', icon: Shapes, tone: 'plain' },
] as const;

const statusNotes: Record<string, string> = {
  received: 'وصل طلبك إلى المكتب وحصل على رقم مرجعي.',
  reviewing: 'يعمل المكتب على طلبك الآن.',
  waiting_on_customer: 'يحتاج المكتب معلومة منك لإكمال الطلب.',
  completed: 'اكتمل طلبك، ويبقى في سجل طلباتك.',
};

const faqs = [
  {
    question: 'كيف أعرف أن طلبي وصل؟',
    answer: 'بعد موافقة المكتب على طلب تسجيلك، يمكنك إرسال طلب خدمة. يظهر الطلب بعدها في قائمة طلباتك برقم مرجعي وحالة «تم الاستلام».',
  },
  {
    question: 'متى يمكنني استخدام خدمات البوابة؟',
    answer: 'بعد إنشاء الحساب والتحقق من البريد، قدّم طلب التسجيل. ستظهر حالته في حسابك، وتُتاح لك خدمات العملاء بعد موافقة المكتب.',
  },
  {
    question: 'هل يمكنني إرسال سؤال قبل تقديم طلب؟',
    answer: 'نعم. من صفحة الاستفسارات داخل حسابك يمكنك إرسال سؤالك ومتابعة رد المكتب عليه.',
  },
  {
    question: 'هل تظهر معاملاتي القديمة هنا؟',
    answer: 'لا. هذه بوابة مستقلة عن تطبيق الهاتف القديم، وسجلاته غير مستوردة. ستجد هنا ما ترسله عبر هذه البوابة.',
  },
  {
    question: 'ما الفرق بين المساعد الآلي واستفسار المكتب؟',
    answer: 'المساعد الآلي يرشدك إلى استخدام البوابة ولا يطّلع على معاملاتك. للسؤال عن طلب أو للحصول على رد من المكتب، أرسل استفسارًا من حسابك.',
  },
  {
    question: 'هل يمكن إرفاق مستندات مع الطلب؟',
    answer: 'نموذج الطلب الحالي لا يتضمن إرفاق ملفات. اكتب التفاصيل الضرورية في الحقول المتاحة، ولا تشارك كلمات مرور أو معلومات حساسة غير مطلوبة.',
  },
];

// Headline words animate one by one. Whole words only: animating single
// letters would break the joins of Arabic script.
const headline = [
  { words: ['من', 'أول', 'طلب،'] },
  { words: ['تعرف', 'أين', 'وصلت', 'معاملتك.'], accent: true },
];

const STATUS_CYCLE_MS = 2800;
const stepNumbers = ['١', '٢', '٣', '٤'];

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Moves through the four request statuses on a loop. Stays on the first
// status when the visitor asked for reduced motion.
function useStatusCycle(enabled: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % statusOptions.length), STATUS_CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return index;
}

// Illustrative request shown in the hero, labelled as an example below the
// card. Its status walks through the portal's real status names.
function RequestPreview({ current }: { current: number }) {
  const status = statusOptions[current];
  return (
    <figure className="lp-preview">
      <div className="lp-orbit lp-orbit--outer" aria-hidden="true" />
      <div className="lp-orbit lp-orbit--inner" aria-hidden="true" />
      <div className="lp-orbit lp-orbit--comet" aria-hidden="true"><span /></div>
      <div className="lp-preview-card">
        <div className="lp-preview-head">
          <div>
            <span className="lp-preview-ref" dir="ltr">HBS-2026-00041</span>
            <p className="lp-preview-title">تجديد إقامة</p>
          </div>
          <span className="lp-preview-pill" data-status={status} key={status}>
            <span aria-hidden="true" />{statusNames[status]}
          </span>
        </div>
        <div className="lp-preview-bar" aria-hidden="true">
          <span style={{ width: `${((current + 1) / statusOptions.length) * 100}%` }} />
        </div>
        <ol className="lp-preview-track" aria-label="مراحل حالة الطلب">
          {statusOptions.map((option, index) => (
            <li key={option} data-state={index < current ? 'done' : index === current ? 'current' : 'next'} aria-current={index === current ? 'step' : undefined}>
              {statusNames[option]}
            </li>
          ))}
        </ol>
        <dl className="lp-preview-meta">
          <div><dt>المجال</dt><dd>العمل</dd></div>
          <div><dt>تاريخ الإرسال</dt><dd>١٤ سبتمبر ٢٠٢٦</dd></div>
        </dl>
      </div>
      <figcaption>مثال توضيحي لصفحة الطلب في حسابك.</figcaption>
    </figure>
  );
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [motion, setMotion] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = useStatusCycle(motion);

  // Sections settle in as they scroll into view. Without JavaScript, or under
  // reduced motion, everything is simply shown.
  useEffect(() => {
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) return;
    setMotion(true);
    const targets = rootRef.current?.querySelectorAll('.lp-reveal') ?? [];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  let wordIndex = 0;

  return (
    <div className="hbs-landing" dir="rtl" ref={rootRef} data-motion={motion ? 'on' : 'off'}>
      <a className="lp-skip" href="#main">تخطَّ إلى المحتوى</a>
      <header className="lp-header">
        <div className="lp-wrap lp-header-inner">
          <Brand light />
          <nav className="lp-nav" aria-label="التنقل الرئيسي">
            {navigation.map((item) => (
              <a key={item.href} href={item.href} data-testid={`link-nav-${item.href.slice(1)}`}>{item.label}</a>
            ))}
          </nav>
          <div className="lp-header-actions">
            <Link href="/sign-in" className="lp-text-link" data-testid="link-header-sign-in">تسجيل الدخول</Link>
            <Link href="/sign-up" className="lp-button lp-button--light" data-testid="link-header-sign-up">
              طلب التسجيل <ArrowLeft size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </Link>
          </div>
          <button
            type="button"
            className="lp-menu-toggle"
            aria-label={menuOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-navigation"
            data-testid="button-toggle-menu"
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X size={21} strokeWidth={ICON_STROKE} /> : <Menu size={21} strokeWidth={ICON_STROKE} />}
          </button>
        </div>
        {menuOpen && (
          <nav id="landing-mobile-navigation" className="lp-wrap lp-mobile-nav" aria-label="التنقل على الهاتف">
            {navigation.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)} data-testid={`link-mobile-${item.href.slice(1)}`}>{item.label}</a>
            ))}
            <Link href="/sign-in" onClick={() => setMenuOpen(false)} data-testid="link-mobile-sign-in">تسجيل الدخول</Link>
            <Link href="/sign-up" className="lp-button lp-button--light" onClick={() => setMenuOpen(false)} data-testid="link-mobile-sign-up">طلب التسجيل <ArrowLeft size={16} strokeWidth={ICON_STROKE} aria-hidden="true" /></Link>
          </nav>
        )}
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="landing-title">
          <div className="lp-hero-glow" aria-hidden="true" />
          <div className="lp-hero-grid-lines" aria-hidden="true" />
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-content">
              <p className="lp-eyebrow lp-enter"><span className="lp-pulse" aria-hidden="true" />بوابة عملاء حلول الغد</p>
              <h1 id="landing-title">
                {headline.map((line, lineIndex) => (
                  <span key={lineIndex} className={line.accent ? 'lp-line lp-line--accent' : 'lp-line'}>
                    {line.words.map((word, index) => {
                      const delay = 0.15 + wordIndex++ * 0.09;
                      return (
                        <Fragment key={word}>
                          {index > 0 && ' '}
                          <span className="lp-word" style={{ animationDelay: `${delay}s` }}>{word}</span>
                        </Fragment>
                      );
                    })}
                  </span>
                ))}
              </h1>
              <p className="lp-hero-lead lp-enter">أرسل طلب خدمة أو استفسارًا من هذه البوابة، وتابع ما أرسلته وحالته من حسابك.</p>
              <div className="lp-hero-actions lp-enter">
                <Link href="/sign-up" className="lp-button lp-button--light lp-button--shine lp-button--large" data-testid="link-hero-sign-up">طلب التسجيل <ArrowLeft size={18} strokeWidth={ICON_STROKE} aria-hidden="true" /></Link>
                <Link href="/sign-in" className="lp-button lp-button--ghost lp-button--large" data-testid="link-hero-sign-in">تسجيل الدخول</Link>
              </div>
            </div>
            <div className="lp-hero-visual lp-enter">
              <RequestPreview current={current} />
            </div>
          </div>
        </section>

        <div className="lp-marquee" aria-hidden="true">
          <div className="lp-marquee-track">
            {[0, 1].map((copy) => (
              <div className="lp-marquee-group" key={copy}>
                {[...serviceAreas, ...serviceAreas].map(({ name }, index) => (
                  <span key={`${copy}-${index}`}><b>{name}</b><i>✦</i></span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <section id="how" className="lp-how" aria-labelledby="how-title">
          <div className="lp-wrap">
            <div className="lp-section-head lp-reveal">
              <div>
                <p className="lp-kicker">كيف تعمل البوابة</p>
                <h2 id="how-title" className="lp-heading">خطوات قليلة، وصورة أوضح لمعاملتك.</h2>
              </div>
              <p className="lp-copy">تبدأ من حسابك، وتبقى تفاصيل ما أرسلته متاحة لك في كل وقت.</p>
            </div>
            <div className="lp-steps-wrap lp-reveal">
              <svg className="lp-steps-line" viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true">
                <path d="M1180 20 C 930 -8, 830 48, 600 20 S 230 -8, 20 20" />
              </svg>
              <ol className="lp-steps">
                {steps.map((step, index) => (
                  <li className="lp-step" key={step.title} style={{ transitionDelay: `${index * 0.08}s` }}>
                    <span className="lp-step-number" aria-hidden="true">{stepNumbers[index]}</span>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="lp-stages" aria-labelledby="stages-title">
          <div className="lp-stages-glow" aria-hidden="true" />
          <div className="lp-wrap">
            <div className="lp-stages-head lp-reveal">
              <p className="lp-kicker">مراحل حالة الطلب</p>
              <h2 id="stages-title" className="lp-heading">كل مرحلة، واضحة لحظة حدوثها.</h2>
            </div>
            <div className="lp-stages-track lp-reveal" aria-hidden="true">
              <span style={{ width: `${((current + 1) / statusOptions.length) * 100}%` }} />
            </div>
            <ol className="lp-stages-list lp-reveal">
              {statusOptions.map((option, index) => (
                <li key={option} data-status={option} data-active={index === current ? 'true' : undefined}>
                  <span className="lp-stage-dot" aria-hidden="true" />
                  <h3>{statusNames[option]}</h3>
                  <p>{statusNotes[option]}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="services" className="lp-services" aria-labelledby="services-title">
          <div className="lp-wrap lp-bento lp-reveal">
            <div className="lp-bento-intro">
              <p className="lp-kicker">مجالات الخدمات</p>
              <h2 id="services-title" className="lp-heading">اختر المجال، واكتب ما تحتاجه.</h2>
              <p className="lp-copy">يستلم المكتب طلبك بالتفاصيل التي أدخلتها، فاكتب الخدمة المطلوبة بوضوح.</p>
              <Link href="/sign-up" className="lp-button lp-button--primary" data-testid="link-services-sign-up">طلب التسجيل <ArrowLeft size={17} strokeWidth={ICON_STROKE} aria-hidden="true" /></Link>
            </div>
            {serviceAreas.map(({ name, icon: Icon, tone }, index) => (
              <div className={`lp-tile lp-tile--${tone} lp-tile-${index + 1}`} key={name}>
                <Icon size={28} strokeWidth={ICON_STROKE} aria-hidden="true" />
                <strong>{name}</strong>
              </div>
            ))}
          </div>
        </section>

        <section id="questions" className="lp-wrap lp-faq lp-reveal" aria-labelledby="faq-title">
          <p className="lp-kicker">الأسئلة الشائعة</p>
          <h2 id="faq-title" className="lp-heading">قبل أن تبدأ، هذه أهم التفاصيل.</h2>
          <p className="lp-copy">وإذا لم تجد ما تبحث عنه، أرسل استفسارًا من حسابك.</p>
          <dl className="lp-faq-grid">
            {faqs.map((faq, index) => (
              <div className="lp-faq-item" key={faq.question} data-testid={`faq-${index}`}>
                <dt>{faq.question}</dt>
                <dd>{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="lp-wrap lp-final lp-reveal" aria-labelledby="final-title">
          <div className="lp-orbit lp-orbit--final-outer" aria-hidden="true" />
          <div className="lp-orbit lp-orbit--final-inner" aria-hidden="true" />
          <h2 id="final-title">ابدأ بطلب التسجيل.</h2>
          <p>بعد موافقة المكتب يمكنك إرسال طلباتك ومتابعتها من حسابك.</p>
          <Link href="/sign-up" className="lp-button lp-button--dark lp-button--shine lp-button--large" data-testid="link-final-sign-up">طلب التسجيل <ArrowLeft size={18} strokeWidth={ICON_STROKE} aria-hidden="true" /></Link>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <div>
            <Brand light />
            <p>بوابة إلكترونية لإرسال طلبات الخدمة والاستفسارات ومتابعتها من حسابك.</p>
          </div>
          <nav className="lp-footer-links" aria-label="روابط التذييل">
            <Link href="/sign-in" data-testid="link-footer-sign-in">تسجيل الدخول</Link>
            <Link href="/sign-up" data-testid="link-footer-sign-up">طلب التسجيل</Link>
            <a href="#how" data-testid="link-footer-how">كيف تعمل البوابة</a>
          </nav>
          <small className="lp-footer-copy">© {new Date().getFullYear()} HBS حلول الغد</small>
        </div>
      </footer>
    </div>
  );
}
