import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Bell, Check, CreditCard, FileText, MessageCircle, Search, Send, UsersRound } from 'lucide-react';
import { introScenes, type IntroScene } from '@/content/intro-script';
import { prefersReducedMotion, safeStorage } from '@/lib/motion';
import './intro.css';

// First-visit opening film: a short motion-graphics explainer of the portal,
// one scene per step (words in content/intro-script.ts). Each scene remounts
// so its CSS animations start fresh; everything animated is transform or
// opacity. The real page renders underneath. Reduced-motion visitors, links
// with a #section and anyone who has seen it skip it; ?intro=1 replays it and
// ?intro=hold stops on the first scene for review.
const STORAGE_KEY = 'hbs:intro:v3';
const EXIT_MS = 620;
// Seconds per scene, in the order of introScenes.
const DURATIONS: Record<IntroScene['key'], number> = { brand: 3.6, request: 3.8, office: 3.8, documents: 3.6, company: 3.8, done: 3.2 };

export function shouldPlayIntro(): boolean {
  if (typeof window === 'undefined') return false;
  const param = new URLSearchParams(window.location.search).get('intro');
  if (prefersReducedMotion()) return false;
  if (param === '0') return false;
  if (param === '1' || param === 'hold') return true;
  if (window.location.hash) return false;
  return safeStorage.get(STORAGE_KEY) !== 'done';
}

export function useIntroState() {
  const [playing, setPlaying] = useState(shouldPlayIntro);
  const finish = useCallback(() => {
    safeStorage.set(STORAGE_KEY, 'done');
    setPlaying(false);
  }, []);
  // The hero's "watch the tour" button plays the film again on request.
  const replay = useCallback(() => setPlaying(true), []);
  return { playing, finish, replay };
}

// Kinetic type: each word rises from behind a mask, one after another.
function Words({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
  return <span className={className}>{text.split(' ').map((word, i) =>
    <Fragment key={i}>{i > 0 && ' '}<span className="iw-mask"><span className="iw-word" style={{ '--d': `${delay + i * 0.07}s` } as CSSProperties}>{word}</span></span></Fragment>)}</span>;
}

function Mark({ size }: { size: number }) {
  return <div className="intro-mark" style={{ width: size, height: size }}>
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id="intro-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1d5a60" /><stop offset="1" stopColor="#0c2a2d" /></linearGradient>
        <linearGradient id="intro-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f6c49f" /><stop offset="1" stopColor="#d9804f" /></linearGradient>
        <radialGradient id="intro-sunglow" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#f6c49f" stopOpacity=".75" /><stop offset="1" stopColor="#f6c49f" stopOpacity="0" /></radialGradient>
        <clipPath id="intro-sky"><rect x="0" y="0" width="64" height="35" /></clipPath>
      </defs>
      <rect className="im-bg" width="64" height="64" rx="15" fill="url(#intro-bg)" />
      <rect className="im-bg" x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="#fff" strokeOpacity=".16" />
      <g clipPath="url(#intro-sky)">
        <circle className="im-glow" cx="32" cy="35" r="18" fill="url(#intro-sunglow)" />
        <circle className="im-sun" cx="32" cy="35" r="9.5" fill="url(#intro-sun)" />
      </g>
      <rect className="im-pillar" x="14" y="15" width="7" height="34" rx="2.5" fill="#f6efe3" />
      <rect className="im-pillar im-pillar--b" x="43" y="15" width="7" height="34" rx="2.5" fill="#f6efe3" />
      <rect className="im-bar" x="14" y="35" width="36" height="4.5" rx="2" fill="#f6efe3" />
    </svg>
    <span className="intro-glint" />
  </div>;
}

// ---- the visual of each scene (illustrative data only) --------------------------

const REF = 'HBS-2026-00041';

function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`iv-card ${className}`} style={style}>{children}</div>;
}

function RequestVisual() {
  return <div className="iv iv-request">
    <Card className="iv-a">
      <div className="iv-search"><Search size={14} /><span className="iv-type">تجديد الإقامة</span></div>
      <div className="iv-chips">{['تجديد الإقامة', 'خروج وعودة', 'نقل خدمات'].map((c, i) =>
        <span key={c} className={`iv-chip ${i === 0 ? 'is-on' : ''}`} style={{ '--d': `${0.5 + i * 0.12}s` } as CSSProperties}>{c}</span>)}</div>
      <div className="iv-lines"><i style={{ '--w': '86%', '--d': '1s' } as CSSProperties} /><i style={{ '--w': '64%', '--d': '1.15s' } as CSSProperties} /><i style={{ '--w': '72%', '--d': '1.3s' } as CSSProperties} /></div>
      <span className="iv-send"><Send size={13} />إرسال الطلب</span>
    </Card>
    <div className="iv-ref"><span>الرقم المرجعي</span><b dir="ltr">{REF}</b></div>
  </div>;
}

const steps = ['تم الاستلام', 'قيد المراجعة', 'تم الرفع للجهة', 'مكتملة'];
function OfficeVisual() {
  return <div className="iv iv-office">
    <Card className="iv-a">
      <div className="iv-head"><b>تجديد الإقامة</b><span dir="ltr">{REF}</span></div>
      <ol className="iv-track">{steps.map((s, i) => <li key={s} style={{ '--d': `${0.5 + i * 0.45}s` } as CSSProperties}><span className="iv-dot"><Check size={10} strokeWidth={3} /></span>{s}</li>)}</ol>
    </Card>
    <div className="iv-chat">
      <span className="iv-bubble is-them" style={{ '--d': '1.6s' } as CSSProperties}><MessageCircle size={13} />رفعنا طلبك للجهة المختصة</span>
      <span className="iv-bubble" style={{ '--d': '2.3s' } as CSSProperties}>شكرًا، متابع معكم</span>
    </div>
  </div>;
}

function DocumentsVisual() {
  return <div className="iv iv-docs">
    <div className="iv-files">{['صورة الإقامة.pdf', 'صورة الجواز.jpg'].map((f, i) =>
      <span key={f} className="iv-file" style={{ '--d': `${0.4 + i * 0.25}s` } as CSSProperties}><FileText size={15} />{f}</span>)}</div>
    <Card className="iv-invoice">
      <div className="iv-head"><b>فاتورة</b><span dir="ltr">INV-2026-00012</span></div>
      <div className="iv-rows"><span>أتعاب الخدمة</span><span dir="ltr">200.00</span><span>ضريبة القيمة المضافة</span><span dir="ltr">30.00</span><b>الإجمالي</b><b dir="ltr">230.00 ر.س</b></div>
      <span className="iv-pay"><CreditCard size={14} />مدى · Apple Pay</span>
      <span className="iv-stamp">مسددة</span>
    </Card>
  </div>;
}

function CompanyVisual() {
  const people = [['أحمد', 'الإقامة', 'بعد 30 يومًا', 'warn'], ['سارة', 'الجواز', 'بعد 140 يومًا', 'ok'], ['راجو', 'رخصة العمل', 'بعد 7 أيام', 'warn']] as const;
  return <div className="iv iv-company">
    <Card className="iv-a">
      <div className="iv-head"><b><UsersRound size={14} /> ملف المنشأة</b><span>3 موظفين</span></div>
      <ul className="iv-people">{people.map(([name, doc, when, tone], i) =>
        <li key={name} style={{ '--d': `${0.45 + i * 0.2}s` } as CSSProperties}><span className="iv-avatar">{name[0]}</span><b>{name}</b><span>{doc}</span><em className={`iv-badge is-${tone}`}>{when}</em></li>)}</ul>
    </Card>
    <div className="iv-alert"><Bell size={15} /><span>تنبيه: إقامة أحمد تنتهي بعد 30 يومًا</span><b>طلب تجديد</b></div>
  </div>;
}

function SceneVisual({ scene }: { scene: IntroScene['key'] }) {
  if (scene === 'request') return <RequestVisual />;
  if (scene === 'office') return <OfficeVisual />;
  if (scene === 'documents') return <DocumentsVisual />;
  if (scene === 'company') return <CompanyVisual />;
  return null;
}

export function IntroSequence({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);
  const hold = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('intro') === 'hold';
  const scene = introScenes[index];

  const leave = useCallback((fast: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (fast) { onDone(); return; }
    setLeaving(true);
    window.setTimeout(onDone, EXIT_MS);
  }, [onDone]);

  // One timer per scene; the last scene hands over to the page.
  useEffect(() => {
    if (hold) return;
    const timer = window.setTimeout(() => {
      if (index < introScenes.length - 1) setIndex(index + 1);
      else leave(false);
    }, DURATIONS[scene.key] * 1000);
    return () => window.clearTimeout(timer);
  }, [index, hold, leave, scene.key]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') leave(true);
      // Arrow keys step through scenes (RTL: left is "next").
      if (event.key === 'ArrowLeft') setIndex(i => Math.min(i + 1, introScenes.length - 1));
      if (event.key === 'ArrowRight') setIndex(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    document.documentElement.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
    };
  }, [leave]);

  const brand = scene.key === 'brand' || scene.key === 'done';
  return (
    <>
      <div className={`intro ${leaving ? 'intro--leaving' : ''} ${hold ? 'intro--hold' : ''}`} aria-hidden="true">
        <div className="intro-bg">
          <span className="intro-pattern" />
          <span className="intro-orb intro-orb--a" />
          <span className="intro-orb intro-orb--b" />
          <span className="intro-sweep" key={`sweep-${index}`} />
        </div>
        <div className="intro-grain" />
        <div key={scene.key} className={`intro-scene intro-scene--${scene.key} ${brand ? 'is-brand' : ''}`}
          style={{ '--len': `${DURATIONS[scene.key]}s` } as CSSProperties}>
          {brand && <Mark size={scene.key === 'brand' ? 112 : 84} />}
          <div className="intro-copy">
            <span className="intro-kicker">{scene.kicker}</span>
            <Words className="intro-title" text={scene.title} delay={brand ? 0.9 : 0.25} />
            {scene.line && <p className="intro-line">{scene.line}</p>}
          </div>
          <SceneVisual scene={scene.key} />
        </div>
        <div className="intro-progress">{introScenes.map((s, i) =>
          <span key={s.key} className={i < index ? 'is-done' : i === index ? 'is-now' : ''}>
            <i style={i === index ? { animationDuration: `${DURATIONS[s.key]}s`, animationPlayState: hold ? 'paused' : 'running' } : undefined} />
          </span>)}</div>
      </div>
      {/* Screen readers get the page itself; the film is decorative. */}
      <button type="button" className={`intro-skip ${leaving ? 'intro-skip--leaving' : ''}`} onClick={() => leave(true)}>
        تخطَّ المقدمة
      </button>
    </>
  );
}
