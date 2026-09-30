import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, BookUser, BriefcaseBusiness, Building2, FileText, Search, ShieldCheck, Shapes, Hash, History } from 'lucide-react';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { IntroSequence, useIntroState } from '@/components/intro';
import { RequestObject, StageRail, stageLabels } from '@/components/request-object';
import { AssistantShowcase, DashboardPreview } from '@/components/landing-previews';
import { HowFilm } from '@/components/how-film';
import { categories, services, type ServiceCategory } from '@/content/services';
import { faqs, journey, trustFacts } from '@/content/site';
import { useReducedMotion, useRevealOnScroll } from '@/lib/motion';
import { trackEvent } from '@/lib/analytics';
import './landing.css';

const ICON = 1.75;
const categoryIcons: Record<ServiceCategory, typeof BookUser> = { passports: BookUser, labor: BriefcaseBusiness, business: Building2, other: Shapes };
const trustIcons = [ShieldCheck, History, Hash];
const dashboardPoints = [
  { title: 'حالة كل طلب', text: 'أربع حالات واضحة تتحدّث كلما عمل المكتب على طلبك.' },
  { title: 'تنبيه عند الحاجة إليك', text: 'إن احتاج المكتب معلومة، يظهر التنبيه أول ما تفتح حسابك.' },
  { title: 'رسائل مرتبطة بالطلب', text: 'استفسارك وردّ المكتب محفوظان مع الطلب نفسه.' },
  { title: 'سجل دائم', text: 'الطلبات المكتملة تبقى بتفاصيلها للرجوع إليها.' },
];
const servicesLabel = (n: number) => (n === 1 ? 'خدمة واحدة' : n === 2 ? 'خدمتان' : n <= 10 ? `${n} خدمات` : `${n} خدمة`);

// Headline words animate one by one. Whole words only: animating single
// letters would break the joins of Arabic script.
const headline = [
  { words: ['من', 'أول', 'طلب،'] },
  { words: ['تعرف', 'أين', 'وصلت', 'معاملتك.'], accent: true },
];

// Plays the hero request through its stages once, then rests on the last
// stage. No endless loop competing with reading.
function useHeroStage(start: boolean, reduced: boolean) {
  const [stage, setStage] = useState(reduced ? 3 : 0);
  const [interacted, setInteracted] = useState(false);
  useEffect(() => {
    if (!start || reduced || interacted) return;
    if (stage >= 3) return;
    const timer = window.setTimeout(() => setStage((s) => s + 1), stage === 0 ? 1400 : 1100);
    return () => window.clearTimeout(timer);
  }, [start, reduced, interacted, stage]);
  return { stage, select: (index: number) => { setInteracted(true); setStage(index); } };
}

function ServiceSearch() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    trackEvent('service_search_submitted', { surface: 'hero', has_query: Boolean(q) });
    navigate(q ? `/services?q=${encodeURIComponent(q)}` : '/services');
  }
  return (
    <form className="lp-search" role="search" onSubmit={submit}>
      <label htmlFor="hero-search" className="sr-only">ابحث عن خدمة</label>
      <Search size={19} strokeWidth={ICON} aria-hidden="true" />
      <input id="hero-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث عن خدمة: تأسيس شركة، إدارة المنصات…" autoComplete="off" />
      <button type="submit" className="btn btn-accent btn-sm">بحث</button>
    </form>
  );
}

export default function Landing() {
  const intro = useIntroState();
  const reduced = useReducedMotion();
  const rootRef = useRevealOnScroll<HTMLDivElement>();
  const hero = useHeroStage(!intro.playing, reduced);
  let wordIndex = 0;

  // Landing is lazy-loaded: the browser's initial hash scroll can happen
  // before the target section exists in the DOM.
  useEffect(() => {
    if (intro.playing) return;
    const scrollToChapter = () => {
      const id = window.location.hash.slice(1);
      if (id !== 'dashboard' && id !== 'assistant') return;
      window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    };
    scrollToChapter();
    window.addEventListener('hashchange', scrollToChapter);
    return () => window.removeEventListener('hashchange', scrollToChapter);
  }, [intro.playing]);

  return (
    <div className="hbs-landing site" dir="rtl" ref={rootRef} data-intro={intro.playing ? 'playing' : 'done'}>
      {intro.playing && <IntroSequence onDone={intro.finish} />}
      <a className="site-skip" href="#main">تخطَّ إلى المحتوى</a>
      <SiteHeader tone="dark" />

      <main id="main" tabIndex={-1}>
        <section className="lp-hero" aria-labelledby="landing-title">
          <div className="site-wrap lp-hero-grid">
            <div className="lp-hero-content">
              <h1 id="landing-title">
                {headline.map((line, lineIndex) => (
                  <span key={lineIndex} className={line.accent ? 'lp-line lp-line--accent' : 'lp-line'}>
                    {line.words.map((word, index) => {
                      const delay = 0.12 + wordIndex++ * 0.08;
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
              <p className="lp-hero-lead lp-enter">من تأسيس الشركات وإدارة المنصات الحكومية إلى إنهاء المعاملات؛ أرسل طلبك إلى المكتب وتابع حالته من حسابك.</p>
              <div className="lp-hero-actions lp-enter">
                <Link href="/sign-up" className="btn btn-light lp-btn-lg" onClick={() => trackEvent('marketing_cta_click', { cta: 'registration', placement: 'hero' })}>طلب التسجيل <ArrowLeft size={18} strokeWidth={ICON} aria-hidden="true" /></Link>
                <Link href="/services" className="btn btn-ghost-dark lp-btn-lg" onClick={() => trackEvent('marketing_cta_click', { cta: 'services', placement: 'hero' })}>تصفّح الخدمات</Link>
              </div>
              <div className="lp-enter lp-search-wrap"><ServiceSearch /></div>
            </div>
            <div className="lp-hero-visual lp-enter-visual">
              <RequestObject stage={hero.stage} tilt caption="مثال" />
              <div className="lp-hero-rail">
                <StageRail stage={hero.stage} onSelect={hero.select} />
              </div>
            </div>
          </div>
        </section>

        <div className="lp-body">
        <section className="lp-categories" aria-labelledby="categories-title">
          <div className="site-wrap">
            <div className="lp-section-head reveal">
              <h2 id="categories-title" className="lp-heading">مجالات الخدمات</h2>
              <Link href="/services" className="lp-arrow-link">كل الخدمات <ArrowLeft size={17} strokeWidth={ICON} aria-hidden="true" /></Link>
            </div>
            <ul className="lp-category-grid">
              {categories.map((category, index) => {
                const Icon = categoryIcons[category.id];
                const count = services.filter((s) => s.category === category.id).length;
                return (
                  <li key={category.id} className="reveal" style={{ transitionDelay: `${index * 70}ms` }}>
                    <Link href={`/services?category=${category.slug}`} className={`lp-category lp-category--${category.id}`}>
                      <span className="lp-category-icon"><Icon size={24} strokeWidth={ICON} aria-hidden="true" /></span>
                      <strong>{category.name}</strong>
                      <span className="lp-category-text">{category.description}</span>
                      <span className="lp-category-foot">{servicesLabel(count)} <ArrowLeft size={15} strokeWidth={ICON} aria-hidden="true" /></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section id="how" className="lp-journey" aria-labelledby="journey-title">
          <div className="lp-journey-glow" aria-hidden="true" />
          <div className="site-wrap">
            <div className="lp-journey-head reveal">
              <h2 id="journey-title" className="lp-heading lp-heading--dark">كيف تعمل البوابة</h2>
            </div>
            <div className="lp-film reveal"><HowFilm /></div>
            <ol className="lp-chapters">
              {journey.map((chapter, index) => (
                <li key={chapter.title} className="lp-chapter">
                  <span className="lp-chapter-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{chapter.title}</h3>
                    <p>{chapter.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="dashboard" className="lp-dashboard" aria-labelledby="dashboard-title">
          <div className="site-wrap">
            <div className="lp-section-head reveal">
              <h2 id="dashboard-title" className="lp-heading">حسابك: كل طلباتك في مكان واحد</h2>
            </div>
            <div className="reveal"><DashboardPreview /></div>
            <ul className="dp-points">
              {dashboardPoints.map((point, index) => (
                <li key={point.title} className="reveal" style={{ transitionDelay: `${index * 70}ms` }}>
                  <strong>{point.title}</strong>
                  <span>{point.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="assistant" className="lp-assistant" aria-labelledby="assistant-title">
          <div className="lp-journey-glow" aria-hidden="true" />
          <div className="site-wrap reveal"><AssistantShowcase /></div>
        </section>

        <section className="lp-trust" aria-labelledby="trust-title">
          <div className="site-wrap">
            <div className="lp-section-head reveal">
              <h2 id="trust-title" className="lp-heading">الخصوصية والأمان</h2>
              <Link href="/trust" className="lp-arrow-link">التفاصيل <ArrowLeft size={17} strokeWidth={ICON} aria-hidden="true" /></Link>
            </div>
            <ul className="lp-trust-grid">
              {trustFacts.map((fact, index) => {
                const Icon = trustIcons[index] ?? FileText;
                return (
                  <li key={fact.title} className="lp-trust-card reveal" style={{ transitionDelay: `${index * 80}ms` }}>
                    <span className="lp-trust-icon"><Icon size={20} strokeWidth={ICON} aria-hidden="true" /></span>
                    <h3>{fact.title}</h3>
                    <p>{fact.text}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section id="questions" className="lp-faq" aria-labelledby="faq-title">
          <div className="site-wrap lp-faq-grid">
            <div className="lp-faq-head reveal">
              <h2 id="faq-title" className="lp-heading">الأسئلة الشائعة</h2>
              <Link href="/help" className="lp-arrow-link">كل الأسئلة <ArrowLeft size={17} strokeWidth={ICON} aria-hidden="true" /></Link>
            </div>
            <div className="lp-faq-list reveal">
              {faqs.slice(0, 5).map((faq) => (
                <details key={faq.question} className="lp-faq-item">
                  <summary>{faq.question}</summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="site-wrap lp-final reveal" aria-labelledby="final-title">
          <div className="lp-final-orbit" aria-hidden="true" />
          <h2 id="final-title">ابدأ بطلب التسجيل</h2>
          <p>بعد موافقة المكتب على تسجيلك، ترسل طلباتك وتتابعها من حسابك.</p>
          <div className="lp-final-actions">
            <Link href="/sign-up" className="btn btn-light lp-btn-lg">طلب التسجيل <ArrowLeft size={18} strokeWidth={ICON} aria-hidden="true" /></Link>
            <Link href="/sign-in" className="btn btn-ghost-dark lp-btn-lg">تسجيل الدخول</Link>
          </div>
        </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
