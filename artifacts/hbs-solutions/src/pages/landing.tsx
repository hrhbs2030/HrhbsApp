import { Fragment, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, BookUser, BriefcaseBusiness, Building2, CalendarClock, FileText, Gauge, MessageSquareWarning, Search, ShieldCheck, Shapes, Hash, History, PlayCircle } from 'lucide-react';
import { SiteFooter, SiteHeader, scrollToChapter } from '@/components/site-chrome';
import { IntroSequence, useIntroState } from '@/components/intro';
import { RequestObject, StageRail, type StageFrame } from '@/components/request-object';
import { AssistantShowcase, DashboardPreview } from '@/components/landing-previews';
import { HowFilm } from '@/components/how-film';
import { categories, services, type ServiceCategory } from '@/content/services';
import { faqs, journey, problemHref, problems, trustFacts, type ProblemKey } from '@/content/site';
import { Reveal, useReducedMotion } from '@/lib/motion';
import './landing.css';

const ICON = 1.75;
const categoryIcons: Record<ServiceCategory, typeof BookUser> = { passports: BookUser, labor: BriefcaseBusiness, business: Building2, other: Shapes };
const trustIcons = [ShieldCheck, History, Hash];
// The three problems (content/site.ts → problems) get an icon; their landing
// place (problemHref) is shared with the service guide and the wizard.
const problemIcons: Record<ProblemKey, typeof BookUser> = { compliance: CalendarClock, indicator: Gauge, observations: MessageSquareWarning };
const serviceName = (slug: string) => services.find((s) => s.slug === slug)?.name;
// What the account shows for each of the three problems. Product facts only:
// reminders at 30/7/1 days, the request statuses from content/milestones.ts,
// the document checklist, email + WhatsApp (opt-in) alerts, the request conversation.
const dashboardPoints = [
  { title: 'تنبيهات الوثائق قبل أن تنتهي', text: 'ملف المنشأة يحفظ تواريخ الإقامات ورخص العمل والتراخيص، ويذكّرك قبل الانتهاء بـ30 يومًا و7 أيام ويوم واحد.' },
  { title: 'حالة كل معالجة أمامك', text: 'من «تم الاستلام» إلى «تم الرفع للجهة» ثم «مكتملة»: تعرف أين وصلت معالجة الملاحظة أو التجديد دون أن تتصل.' },
  { title: '«بانتظار العميل» عندما يلزم شيء منك', text: 'قائمة المستندات داخل الطلب تبيّن ما ينقص، ويصلك التنبيه بالبريد، وبواتساب إن فعّلته.' },
  { title: 'تفسير المكتب في محادثة الطلب', text: 'سبب تغيّر المؤشر، وما أُعدّ للتصحيح، وما يحتاج قرارًا منك: كله في صفحة الطلب نفسها، لا في رسائل متفرقة.' },
];
const servicesLabel = (n: number) => (n === 1 ? 'خدمة واحدة' : n === 2 ? 'خدمتان' : n <= 10 ? `${n} خدمات` : `${n} خدمة`);

// Headline words animate one by one. Whole words only: animating single
// letters would break the joins of Arabic script. Keys are the words, so no
// word repeats inside a line.
const headline = [
  { words: ['ملاحظة', 'على', 'ملفك،', 'أو', 'مؤشر', 'تغيّر؟'] },
  { words: ['أرسلها،', 'وتابع', 'معالجتها', 'من', 'حسابك.'], accent: true },
];

// Plays the hero request through its milestones once, pausing at «بانتظار
// العميل» on the way, then rests on the last one. No endless loop competing
// with reading. Picking a station on the rail jumps straight to that milestone.
const heroFrames: StageFrame[] = [{ stage: 0 }, { stage: 1 }, { stage: 1, pause: 'waiting_on_customer' }, { stage: 2 }, { stage: 3 }];
function useHeroStage(start: boolean, reduced: boolean) {
  const lastFrame = heroFrames.length - 1;
  const [frame, setFrame] = useState(reduced ? lastFrame : 0);
  const [picked, setPicked] = useState<StageFrame | null>(null);
  useEffect(() => {
    if (!start || reduced || picked || frame >= lastFrame) return;
    const timer = window.setTimeout(() => setFrame((f) => f + 1), frame === 0 ? 1400 : 1100);
    return () => window.clearTimeout(timer);
  }, [start, reduced, picked, frame, lastFrame]);
  return { ...(picked ?? heroFrames[frame]), select: (index: number) => setPicked({ stage: index }) };
}

// `compact` is the phone version shown in the service-areas section, where
// the long placeholder would be cut off.
function ServiceSearch({ compact = false }: { compact?: boolean }) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  const id = useId();
  function submit(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    navigate(q ? `/services?q=${encodeURIComponent(q)}` : '/services');
  }
  return (
    <form className={`lp-search ${compact ? 'lp-search--light' : ''}`} role="search" onSubmit={submit}>
      <label htmlFor={id} className="sr-only">ابحث عن خدمة</label>
      <Search size={19} strokeWidth={ICON} aria-hidden="true" />
      <input id={id} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={compact ? 'ابحث عن خدمة…' : 'ابحث: حماية الأجور، رخصة عمل، تجديد إقامة…'} autoComplete="off" />
      <button type="submit" className="btn btn-accent btn-sm">بحث</button>
    </form>
  );
}

// Section heading row: title + copy on one side, an optional arrow link on the
// other. `dark` flips the text tokens for night bands.
function SectionHead({ id, title, text, dark = false, action }: { id: string; title: string; text: string; dark?: boolean; action?: ReactNode }) {
  return (
    <Reveal className="lp-section-head">
      <div>
        <h2 id={id} className={`lp-heading ${dark ? 'lp-heading--dark' : ''}`}>{title}</h2>
        <p className={`lp-copy ${dark ? 'lp-copy--dark' : ''}`}>{text}</p>
      </div>
      {action}
    </Reveal>
  );
}

export default function Landing() {
  const intro = useIntroState();
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const hero = useHeroStage(!intro.playing, reduced);
  // The film returns focus to whichever replay button is visible (hero on desktop, journey section on phones).
  const replayHero = useRef<HTMLButtonElement>(null);
  const replayHow = useRef<HTMLButtonElement>(null);
  let wordIndex = 0;

  // Landing is lazy-loaded: the browser's initial hash scroll happens before
  // the chapters exist in the DOM, and a "/#how" link from another page
  // arrives as a client-side navigation (site-chrome navigateHash). Once the
  // intro is out of the way, scroll to whatever chapter the hash names, after
  // the fonts have loaded and the layout has settled so the offset is final.
  useEffect(() => {
    if (intro.playing) return;
    let cancelled = false;
    let frame = 0;
    const goToHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id || id === 'main') return;
      const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
      (fonts?.ready ?? Promise.resolve()).then(() => {
        if (cancelled) return;
        frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(() => { if (!cancelled) scrollToChapter(id, reduced ? 'auto' : 'smooth'); }); });
      });
    };
    goToHash();
    window.addEventListener('hashchange', goToHash);
    return () => { cancelled = true; window.cancelAnimationFrame(frame); window.removeEventListener('hashchange', goToHash); };
  }, [intro.playing, reduced]);

  return (
    <div className="hbs-landing site" dir="rtl" ref={rootRef} data-intro={intro.playing ? 'playing' : 'done'}>
      {intro.playing && <IntroSequence onDone={intro.finish} pageRef={rootRef} focusRef={[replayHero, replayHow]} />}
      <a className="site-skip" href="#main">تخطَّ إلى المحتوى</a>
      <SiteHeader tone="dark" />

      <main id="main" tabIndex={-1}>
        <section className="lp-hero" aria-labelledby="landing-title">
          {/* Depth over the city scene: a night gradient, a copper glow and film grain. Decorative only. */}
          <div className="lp-hero-depth" aria-hidden="true" />
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
              <p className="lp-hero-lead lp-enter">إقامة أو رخصة تنتهي، نطاق أو مؤشر التزام يتغيّر، ملاحظة من جهة مختصة لا تعرف من أين تبدأ بها: أرسلها كما وصلتك، ويحدد المكتب سببها ويعدّ ما يلزم عبر المنصات المختصة، وأنت تتابع كل خطوة برقم مرجعي من حسابك.</p>
              <div className="lp-hero-actions lp-enter">
                <Link href="/sign-up" className="btn btn-light lp-btn-lg">قدّم طلب التسجيل <ArrowLeft size={18} strokeWidth={ICON} aria-hidden="true" /></Link>
                <Link href="/services" className="btn btn-ghost-dark lp-btn-lg lp-hero-secondary">تصفّح دليل الخدمات</Link>
              </div>
              {/* On phones the search moves below the fold, into the service areas. */}
              <div className="lp-enter lp-search-wrap lp-search-wrap--hero"><ServiceSearch /></div>
              <button type="button" className="intro-replay lp-enter lp-replay--hero" onClick={intro.replay} ref={replayHero}>
                <PlayCircle size={18} strokeWidth={ICON} aria-hidden="true" /> شاهد جولة سريعة في النظام
              </button>
            </div>
            <div className="lp-hero-visual lp-enter-visual">
              <RequestObject stage={hero.stage} pause={hero.pause} tilt caption="مثال" />
              <div className="lp-hero-rail">
                <StageRail stage={hero.stage} pause={hero.pause} onSelect={hero.select} />
              </div>
            </div>
          </div>
        </section>

        <div className="lp-body">
        <section id="problems" className="lp-section lp-problems band-paper" aria-labelledby="problems-title">
          <div className="site-wrap">
            <SectionHead id="problems-title" title="مشاكل نحلّها" text="ثلاث حالات يصل بها أصحاب المنشآت إلى المكتب أكثر من غيرها. في كل واحدة: ما الذي يفعله المكتب، وما الذي تراه أنت في حسابك." />
            <ul className="lp-problem-grid">
              {problems.map((problem, index) => {
                const Icon = problemIcons[problem.key];
                return (
                  <Reveal as="li" key={problem.key} className={`lp-problem lp-problem--${problem.key}`} delay={index * 90}>
                    <div className="lp-problem-top">
                      <span className="lp-problem-icon"><Icon size={22} strokeWidth={ICON} aria-hidden="true" /></span>
                      <span className="lp-problem-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    </div>
                    <h3>{problem.title}</h3>
                    <p className="lp-problem-pain">{problem.pain}</p>
                    <dl className="lp-problem-detail">
                      <dt>ما يفعله المكتب</dt>
                      <dd>{problem.approach}</dd>
                      <dt>ما تراه في حسابك</dt>
                      <dd>{problem.portal}</dd>
                    </dl>
                    <div className="lp-problem-services">
                      <span className="lp-problem-services-label">الخدمات المتعلقة</span>
                      <ul>
                        {problem.services.map((slug) => {
                          const name = serviceName(slug);
                          return name ? <li key={slug}><Link href={`/services/${slug}`} className="lp-chip">{name}</Link></li> : null;
                        })}
                      </ul>
                    </div>
                    <Link href={problemHref[problem.key]} className="btn btn-accent lp-problem-cta">{problem.cta} <ArrowLeft size={17} strokeWidth={ICON} aria-hidden="true" /></Link>
                  </Reveal>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="lp-section lp-categories band-sage" aria-labelledby="categories-title">
          <div className="site-wrap">
            <SectionHead id="categories-title" title="بماذا يخدمك المكتب؟" text="خدمات المنشأة في الجوازات والعمل والتراخيص، مرتّبة بحسب المجال. لكل خدمة صفحة تبيّن ما يفيد المكتب أن تذكره في طلبك."
              action={<Link href="/services" className="lp-arrow-link">كل الخدمات <ArrowLeft size={17} strokeWidth={ICON} aria-hidden="true" /></Link>} />
            <Reveal className="lp-search-wrap lp-search-wrap--mobile"><ServiceSearch compact /></Reveal>
            <ul className="lp-category-grid">
              {categories.map((category, index) => {
                const Icon = categoryIcons[category.id];
                const count = services.filter((s) => s.category === category.id).length;
                return (
                  <Reveal as="li" key={category.id} delay={index * 70}>
                    <Link href={`/services?category=${category.slug}`} className={`lp-category lp-category--${category.id}`}>
                      <span className="lp-category-icon"><Icon size={24} strokeWidth={ICON} aria-hidden="true" /></span>
                      <strong>{category.name}</strong>
                      <span className="lp-category-text">{category.description}</span>
                      <span className="lp-category-foot">{servicesLabel(count)} <ArrowLeft size={15} strokeWidth={ICON} aria-hidden="true" /></span>
                    </Link>
                  </Reveal>
                );
              })}
            </ul>
          </div>
        </section>

        <section id="how" className="lp-section lp-journey night-gradient grain" aria-labelledby="journey-title">
          <div className="lp-journey-glow" aria-hidden="true" />
          <div className="site-wrap">
            <Reveal className="lp-journey-head">
              <div>
                <h2 id="journey-title" className="lp-heading lp-heading--dark">من الملاحظة إلى إغلاقها: كيف تعمل البوابة</h2>
                <p className="lp-copy lp-copy--dark">الطريق نفسه لكل طلب: تجديد قبل الانتهاء، أو تصحيح ما يؤثر في المؤشر، أو معالجة ملاحظة. تعرف الحالة في كل خطوة، وتعرف متى يلزم شيء من طرفك.</p>
              </div>
              <button type="button" className="intro-replay lp-replay--how" onClick={intro.replay} ref={replayHow}>
                <PlayCircle size={18} strokeWidth={ICON} aria-hidden="true" /> شاهد الجولة السريعة
              </button>
            </Reveal>
            <Reveal className="lp-film"><HowFilm /></Reveal>
            {/* Timeline: a rail with one stop per chapter; on phones it scrolls sideways and snaps per chapter. */}
            <ol className="lp-chapters" aria-labelledby="journey-title" tabIndex={0}>
              {journey.map((chapter, index) => (
                <Reveal as="li" key={chapter.title} className="lp-chapter" delay={index * 60}>
                  <span className="lp-chapter-rail" aria-hidden="true"><i /></span>
                  <span className="lp-chapter-kicker">{chapter.kicker}</span>
                  <span className="lp-chapter-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{chapter.title}</h3>
                    <p>{chapter.text}</p>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section id="dashboard" className="lp-section lp-dashboard band-paper" aria-labelledby="dashboard-title">
          <div className="site-wrap">
            <SectionHead id="dashboard-title" title="حسابك: التزام منشأتك أمامك" text="ما ينتهي قريبًا، وما يعالجه المكتب الآن، وما ينتظر شيئًا منك: في صفحة واحدة، بدل الاتصال للسؤال." />
            <Reveal><DashboardPreview /></Reveal>
            <ul className="dp-points">
              {dashboardPoints.map((point, index) => (
                <Reveal as="li" key={point.title} delay={index * 70}>
                  <strong>{point.title}</strong>
                  <span>{point.text}</span>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        <section id="assistant" className="lp-section lp-assistant night-gradient grain" aria-labelledby="assistant-title">
          <div className="lp-journey-glow" aria-hidden="true" />
          <Reveal className="site-wrap"><AssistantShowcase /></Reveal>
        </section>

        <section className="lp-section lp-trust band-sage" aria-labelledby="trust-title">
          <div className="site-wrap">
            <SectionHead id="trust-title" title="الخصوصية والأمان" text="ملف الأجور والملاحظات وبيانات الموظفين تبقى بين منشأتك والمكتب. هذا ما تعنيه الثقة هنا عمليًا."
              action={<Link href="/trust" className="lp-arrow-link">كيف نحمي بياناتك <ArrowLeft size={17} strokeWidth={ICON} aria-hidden="true" /></Link>} />
            <ul className="lp-trust-grid">
              {trustFacts.map((fact, index) => {
                const Icon = trustIcons[index] ?? FileText;
                return (
                  <Reveal as="li" key={fact.title} className="lp-trust-card" delay={index * 80}>
                    <span className="lp-trust-icon"><Icon size={20} strokeWidth={ICON} aria-hidden="true" /></span>
                    <h3>{fact.title}</h3>
                    <p>{fact.text}</p>
                  </Reveal>
                );
              })}
            </ul>
          </div>
        </section>

        <section id="questions" className="lp-section lp-faq band-paper" aria-labelledby="faq-title">
          <div className="site-wrap lp-faq-grid">
            <Reveal className="lp-faq-head">
              <h2 id="faq-title" className="lp-heading">الأسئلة الشائعة</h2>
              <Link href="/help" className="lp-arrow-link">كل الأسئلة <ArrowLeft size={17} strokeWidth={ICON} aria-hidden="true" /></Link>
            </Reveal>
            <div className="lp-faq-list">
              {faqs.slice(0, 5).map((faq, index) => (
                <Reveal as="details" key={faq.question} className="lp-faq-item" delay={index * 60}>
                  <summary>{faq.question}</summary>
                  <p>{faq.answer}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-final night-gradient grain" aria-labelledby="final-title">
          <div className="lp-final-orbit" aria-hidden="true" />
          <Reveal className="site-wrap lp-final-inner">
            <h2 id="final-title">ابدأ قبل أن يصبح التأخير ملاحظة</h2>
            <p>قدّم طلب التسجيل، وبعد موافقة المكتب أرسل ما يظهر لك على منشأتك، وتابع معالجته من حسابك برقم مرجعي لكل طلب.</p>
            <div className="lp-final-actions">
              <Link href="/sign-up" className="btn btn-light lp-btn-lg">طلب التسجيل <ArrowLeft size={18} strokeWidth={ICON} aria-hidden="true" /></Link>
              <Link href="/sign-in" className="btn btn-ghost-dark lp-btn-lg">تسجيل الدخول</Link>
            </div>
          </Reveal>
        </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
