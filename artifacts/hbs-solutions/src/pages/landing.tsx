import { useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowLeft, Check, ChevronDown, CircleHelp, ClipboardCheck,
  FileText, ListChecks, LockKeyhole, Menu, MessageSquareText, X,
} from 'lucide-react';
import { Brand } from '@/components/portal-ui';
import './landing.css';

const navigation = [
  { href: '#how', label: 'كيف تعمل البوابة' },
  { href: '#services', label: 'مجالات الخدمات' },
  { href: '#questions', label: 'الأسئلة الشائعة' },
];

const steps = [
  { number: '01', title: 'قدّم طلب تسجيل', text: 'أنشئ حسابًا بالبريد الإلكتروني، ثم أرسل بياناتك للمكتب لمراجعة طلب التسجيل.' },
  { number: '02', title: 'بعد الموافقة، أرسل طلبك', text: 'اختر المجال، واكتب الخدمة المطلوبة وتفاصيلها، وأضف رقمًا للتواصل.' },
  { number: '03', title: 'تابع حالة الطلب', text: 'تابع الحالة التي يحدّثها المكتب، وارجع إلى رقمك المرجعي وتفاصيل الطلب.' },
];

const serviceAreas = ['الجوازات', 'العمل', 'الأعمال', 'خدمات أخرى'];

const faqs = [
  {
    question: 'كيف أعرف أن طلبي وصل؟',
    answer: 'بعد موافقة المكتب على طلب تسجيلك، يمكنك إرسال طلب خدمة. يظهر طلب الخدمة بعدها في قائمة طلباتك برقم مرجعي وحالة «تم الاستلام».',
  },
  {
    question: 'متى يمكنني استخدام خدمات البوابة؟',
    answer: 'بعد إنشاء الحساب والتحقق من البريد، قدّم طلب التسجيل. ستظهر حالة الطلب في حسابك، وتُتاح لك خدمات العملاء بعد موافقة المكتب.',
  },
  {
    question: 'هل يمكنني إرسال سؤال قبل تقديم طلب؟',
    answer: 'نعم. من صفحة الاستفسارات داخل حسابك يمكنك إرسال سؤالك ومتابعة رد المكتب عليه.',
  },
  {
    question: 'هل تظهر معاملاتي القديمة هنا؟',
    answer: 'لا. هذه بوابة مستقلة عن تطبيق الهاتف القديم؛ سجلات التطبيق القديم غير مستوردة. ستجد هنا ما ترسله عبر هذه البوابة.',
  },
  {
    question: 'ما الفرق بين المساعد الآلي واستفسار المكتب؟',
    answer: 'المساعد الآلي يرشدك إلى استخدام البوابة ولا يطّلع على معاملاتك. للاستفسار عن طلب أو للحصول على رد من المكتب، أرسل استفسارًا من حسابك.',
  },
  {
    question: 'هل يمكن إرفاق مستندات مع الطلب؟',
    answer: 'نموذج الطلب الحالي لا يتضمن إرفاق ملفات. اكتب التفاصيل الضرورية في الحقول المتاحة، ولا تشارك كلمات مرور أو معلومات حساسة غير مطلوبة.',
  },
];

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="hbs-landing" dir="rtl">
      <header className="lp-header">
        <div className="lp-wrap lp-header-inner">
          <Brand />
          <nav className="lp-nav" aria-label="التنقل الرئيسي">
            {navigation.map((item) => (
              <a key={item.href} href={item.href} data-testid={`link-nav-${item.href.slice(1)}`}>{item.label}</a>
            ))}
          </nav>
          <div className="lp-header-actions">
            <Link href="/sign-in" className="lp-button lp-button--line" data-testid="link-header-sign-in">تسجيل الدخول</Link>
            <Link href="/sign-up" className="lp-button lp-button--dark" data-testid="link-header-sign-up">
              طلب التسجيل <ArrowLeft size={16} aria-hidden="true" />
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
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
        {menuOpen && (
          <nav id="landing-mobile-navigation" className="lp-wrap lp-mobile-nav" aria-label="التنقل على الهاتف">
            {navigation.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)} data-testid={`link-mobile-${item.href.slice(1)}`}>{item.label}</a>
            ))}
            <Link href="/sign-in" onClick={() => setMenuOpen(false)} data-testid="link-mobile-sign-in">تسجيل الدخول</Link>
            <Link href="/sign-up" className="lp-button lp-button--dark" onClick={() => setMenuOpen(false)} data-testid="link-mobile-sign-up">طلب التسجيل <ArrowLeft size={16} aria-hidden="true" /></Link>
          </nav>
        )}
      </header>

      <main>
        <section className="lp-hero" aria-labelledby="landing-title">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-content">
              <div className="lp-overline"><span aria-hidden="true" />البوابة الإلكترونية لعملاء حلول الغد</div>
              <h1 id="landing-title">من أول طلب،<br /><em>تعرف أين وصلت معاملتك.</em></h1>
              <p className="lp-hero-lead">
                أرسل طلب خدمة أو استفسارًا من هذه البوابة، وتابع ما أرسلته وحالته من حسابك.
              </p>
              <div className="lp-hero-actions">
                <Link href="/sign-up" className="lp-button lp-button--dark" data-testid="link-hero-sign-up">قدّم طلب التسجيل <ArrowLeft size={18} aria-hidden="true" /></Link>
                <Link href="/sign-in" className="lp-button lp-button--line" data-testid="link-hero-sign-in">لدي حساب بالفعل</Link>
              </div>
              <div className="lp-hero-note">
                <CircleHelp size={17} aria-hidden="true" />
                <span>هذه بوابة مستقلة عن تطبيق الهاتف القديم؛ سجلات التطبيق القديم غير مستوردة. ستجد هنا ما ترسله عبر هذه البوابة.</span>
              </div>
            </div>
            <div className="lp-visual" aria-label="رسم توضيحي لكيفية ظهور حالة الطلب داخل البوابة">
              <span className="lp-specimen">نموذج توضيحي للواجهة</span>
              <div className="lp-document">
                <div className="lp-document-top">
                  <div>
                    <span className="lp-document-label">بوابة العملاء / الطلبات</span>
                    <div className="lp-document-title">تفاصيل الطلب</div>
                  </div>
                  <span className="lp-doc-icon"><FileText size={23} strokeWidth={1.6} aria-hidden="true" /></span>
                </div>
                <div className="lp-doc-row"><span>الرقم المرجعي</span><strong>يظهر بعد إرسال الطلب</strong></div>
                <div className="lp-doc-row"><span>حالة الطلب</span><span className="lp-status"><i aria-hidden="true" />تم الاستلام</span></div>
                <div className="lp-doc-row"><span>التفاصيل</span><strong>محفوظة في حسابك</strong></div>
                <div className="lp-doc-progress" aria-hidden="true"><span /><span /><span /><span /></div>
                <div className="lp-doc-caption">تتغير الحالة عندما يُحدّث المكتب الطلب.</div>
              </div>
              <div className="lp-visual-tab"><Check size={18} aria-hidden="true" />كل طلب يبدأ بتسجيل واضح</div>
            </div>
          </div>
        </section>

        <section className="lp-proof" aria-label="ما توفره البوابة">
          <div className="lp-wrap lp-proof-grid">
            <div className="lp-proof-item"><ClipboardCheck size={25} strokeWidth={1.6} aria-hidden="true" /><div><strong>رقم مرجعي لكل طلب</strong><small>تعود به إلى معاملتك في حسابك</small></div></div>
            <div className="lp-proof-item"><LockKeyhole size={25} strokeWidth={1.6} aria-hidden="true" /><div><strong>مساحة خاصة بك</strong><small>طلباتك واستفساراتك في مكان واحد</small></div></div>
            <div className="lp-proof-item"><MessageSquareText size={25} strokeWidth={1.6} aria-hidden="true" /><div><strong>استفسار ومتابعة</strong><small>أرسل سؤالك وتابع رد المكتب</small></div></div>
          </div>
        </section>

        <section id="how" className="lp-wrap lp-process" aria-labelledby="how-title">
          <div className="lp-section-intro">
            <div><span className="lp-kicker">الطريقة ببساطة</span><h2 id="how-title" className="lp-heading">خطوات قليلة.<br />صورة أوضح لمعاملتك.</h2></div>
            <p className="lp-copy">لا تحتاج للبحث عن آخر رسالة. تبدأ من حسابك، وتبقى تفاصيل ما أرسلته متاحة لك.</p>
          </div>
          <div className="lp-steps">
            {steps.map((step) => (
              <article className="lp-step" key={step.number}>
                <span className="lp-step-number" aria-hidden="true">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="services" className="lp-services" aria-labelledby="services-title">
          <div className="lp-wrap lp-services-grid">
            <div>
              <span className="lp-kicker">مجالات الخدمة</span>
              <h2 id="services-title" className="lp-heading">أخبرنا بما تحتاجه.<br />ودع التفاصيل تبدأ صحيحة.</h2>
              <p className="lp-copy">اختر المجال المناسب، ثم اكتب الخدمة المطلوبة بوضوح. يستلم المكتب طلبك بالتفاصيل التي أدخلتها.</p>
              <Link href="/sign-up" className="lp-button lp-button--light" data-testid="link-services-sign-up">طلب التسجيل <ArrowLeft size={17} aria-hidden="true" /></Link>
            </div>
            <div>
              <div className="lp-service-list">
                {serviceAreas.map((area, index) => (
                  <div className="lp-service-row" key={area}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{area}</strong>
                    <ArrowLeft size={18} strokeWidth={1.5} aria-hidden="true" />
                  </div>
                ))}
              </div>
              <div className="lp-service-foot">حدد الخدمة وتفاصيلها عند تقديم الطلب من حسابك.</div>
            </div>
          </div>
        </section>

        <section className="lp-wrap lp-clarity" aria-labelledby="clarity-title">
          <div>
            <span className="lp-kicker">متابعة بلا تخمين</span>
            <h2 id="clarity-title" className="lp-heading">تعرف ما أرسلته.<br />وترى ما تغيّر.</h2>
            <p className="lp-copy">لكل طلب صفحة تجمع تفاصيله ورقمه المرجعي وحالته وتاريخ إرساله. وإذا كان لديك سؤال، يمكنك إرساله من مساحة الاستفسارات ومتابعة رد المكتب هناك.</p>
            <ul className="lp-check-list">
              <li><Check size={18} aria-hidden="true" />تفاصيل الطلب محفوظة في حسابك</li>
              <li><Check size={18} aria-hidden="true" />حالة واضحة لكل طلب</li>
              <li><Check size={18} aria-hidden="true" />استفساراتك وردود المكتب في مكان واحد</li>
            </ul>
          </div>
          <div className="lp-clarity-panel" aria-label="المعلومات التي يمكنك متابعتها">
            <span className="lp-panel-label">داخل حسابك</span>
            <h3 className="lp-panel-title">سجل واضح، من البداية.</h3>
            <div className="lp-panel-row"><FileText size={19} aria-hidden="true" /><div><strong>الطلب وتفاصيله</strong><p>ما كتبته عند تقديم الخدمة، محفوظ لتعود إليه.</p></div></div>
            <div className="lp-panel-row"><ListChecks size={19} aria-hidden="true" /><div><strong>الرقم المرجعي والحالة</strong><p>تتعرف على طلبك وتتابع حالته من مكان واحد.</p></div></div>
            <div className="lp-panel-row"><MessageSquareText size={19} aria-hidden="true" /><div><strong>أسئلتك للمكتب</strong><p>أرسل استفسارًا واطّلع على الرد من حسابك.</p></div></div>
            <div className="lp-panel-bottom"><Check size={16} aria-hidden="true" />المتابعة تبدأ بعد إرسال الطلب عبر الموقع</div>
          </div>
        </section>

        <section id="questions" className="lp-faq" aria-labelledby="faq-title">
          <div className="lp-wrap lp-faq-grid">
            <div>
              <span className="lp-kicker">إجابات مباشرة</span>
              <h2 id="faq-title" className="lp-heading">قبل أن تبدأ،<br />هذه أهم التفاصيل.</h2>
              <p className="lp-copy">وإذا لم تجد ما تبحث عنه، يمكنك إرسال استفسار من حسابك.</p>
            </div>
            <div className="lp-faq-list">
              {faqs.map((faq, index) => (
                <div className="lp-faq-item" key={faq.question}>
                  <button
                    type="button"
                    aria-expanded={openFaq === index}
                    aria-controls={`landing-faq-answer-${index}`}
                    data-testid={`button-faq-${index}`}
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  >
                    {faq.question}<ChevronDown size={19} aria-hidden="true" />
                  </button>
                  <p id={`landing-faq-answer-${index}`} className="lp-faq-answer" hidden={openFaq !== index}>{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-final" aria-labelledby="final-title">
          <div className="lp-wrap lp-final-inner">
            <div><h2 id="final-title">ابدأ طلبك بخطوة واضحة.</h2><p>أنشئ حسابًا وقدّم طلب تسجيلك؛ وبعد الموافقة يمكنك إرسال معاملاتك ومتابعتها.</p></div>
            <Link href="/sign-up" className="lp-button lp-button--light" data-testid="link-final-sign-up">طلب التسجيل <ArrowLeft size={18} aria-hidden="true" /></Link>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-top">
            <div><Brand light /><p>بوابة إلكترونية لإرسال طلبات الخدمة والاستفسارات ومتابعتها من حسابك.</p></div>
            <nav className="lp-footer-links" aria-label="روابط التذييل">
              <Link href="/sign-in" data-testid="link-footer-sign-in">تسجيل الدخول</Link>
              <Link href="/sign-up" data-testid="link-footer-sign-up">طلب التسجيل</Link>
              <a href="#how" data-testid="link-footer-how">كيف تعمل</a>
            </nav>
          </div>
          <div className="lp-footer-bottom">© {new Date().getFullYear()} HBS حلول الغد</div>
        </div>
      </footer>
    </div>
  );
}