import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, BookUser, BriefcaseBusiness, Building2, Menu, Shapes, X } from 'lucide-react';
import { Brand, Status, statusNames, statusOptions } from '@/components/portal-ui';
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

// Illustrative request shown in the hero. It uses the portal's real status
// names and pill, and is labelled as an example below the card.
const exampleStatus = 'reviewing';

function RequestPreview() {
  const current = statusOptions.indexOf(exampleStatus);
  return (
    <figure className="lp-preview">
      <div className="lp-preview-card">
        <div className="lp-preview-head">
          <div>
            <span className="lp-preview-ref" dir="ltr">HBS-2026-00041</span>
            <p className="lp-preview-title">تجديد إقامة</p>
          </div>
          <Status value={exampleStatus} />
        </div>
        <dl className="lp-preview-meta">
          <div><dt>المجال</dt><dd>العمل</dd></div>
          <div><dt>تاريخ الإرسال</dt><dd>١٤ سبتمبر ٢٠٢٦</dd></div>
        </dl>
        <ol className="lp-preview-track" aria-label="مراحل حالة الطلب">
          {statusOptions.map((status, index) => (
            <li key={status} data-state={index < current ? 'done' : index === current ? 'current' : 'next'} aria-current={index === current ? 'step' : undefined}>
              {statusNames[status]}
            </li>
          ))}
        </ol>
      </div>
      <figcaption>مثال توضيحي لصفحة الطلب في حسابك.</figcaption>
    </figure>
  );
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="hbs-landing" dir="rtl">
      <a className="lp-skip" href="#main">تخطَّ إلى المحتوى</a>
      <header className="lp-header">
        <div className="lp-wrap lp-header-inner">
          <Brand />
          <nav className="lp-nav" aria-label="التنقل الرئيسي">
            {navigation.map((item) => (
              <a key={item.href} href={item.href} data-testid={`link-nav-${item.href.slice(1)}`}>{item.label}</a>
            ))}
          </nav>
          <div className="lp-header-actions">
            <Link href="/sign-in" className="lp-text-link" data-testid="link-header-sign-in">تسجيل الدخول</Link>
            <Link href="/sign-up" className="lp-button lp-button--primary" data-testid="link-header-sign-up">
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
            <Link href="/sign-up" className="lp-button lp-button--primary" onClick={() => setMenuOpen(false)} data-testid="link-mobile-sign-up">طلب التسجيل <ArrowLeft size={16} strokeWidth={ICON_STROKE} aria-hidden="true" /></Link>
          </nav>
        )}
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="landing-title">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-content">
              <p className="lp-eyebrow lp-enter">بوابة عملاء حلول الغد</p>
              <h1 id="landing-title" className="lp-enter">من أول طلب، <span>تعرف أين وصلت معاملتك.</span></h1>
              <p className="lp-hero-lead lp-enter">أرسل طلب خدمة أو استفسارًا من هذه البوابة، وتابع ما أرسلته وحالته من حسابك.</p>
              <div className="lp-hero-actions lp-enter">
                <Link href="/sign-up" className="lp-button lp-button--primary" data-testid="link-hero-sign-up">طلب التسجيل <ArrowLeft size={18} strokeWidth={ICON_STROKE} aria-hidden="true" /></Link>
                <Link href="/sign-in" className="lp-text-link" data-testid="link-hero-sign-in">تسجيل الدخول</Link>
              </div>
            </div>
            <div className="lp-hero-visual lp-enter">
              <RequestPreview />
            </div>
          </div>
        </section>

        <section id="how" className="lp-wrap lp-how lp-reveal" aria-labelledby="how-title">
          <div className="lp-how-intro">
            <h2 id="how-title" className="lp-heading">خطوات قليلة، وصورة أوضح لمعاملتك.</h2>
            <p className="lp-copy">تبدأ من حسابك، وتبقى تفاصيل ما أرسلته متاحة لك في كل وقت.</p>
          </div>
          <ol className="lp-steps">
            {steps.map((step) => (
              <li className="lp-step" key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="services" className="lp-services lp-reveal" aria-labelledby="services-title">
          <div className="lp-wrap lp-bento">
            <div className="lp-bento-intro">
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
          <div>
            <h2 id="final-title">ابدأ بطلب التسجيل.</h2>
            <p>بعد موافقة المكتب يمكنك إرسال طلباتك ومتابعتها من حسابك.</p>
          </div>
          <Link href="/sign-up" className="lp-button lp-button--primary" data-testid="link-final-sign-up">طلب التسجيل <ArrowLeft size={18} strokeWidth={ICON_STROKE} aria-hidden="true" /></Link>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <div>
            <Brand />
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
