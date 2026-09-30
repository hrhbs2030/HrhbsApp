import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { blocks, Palm, Skyline, Stars, Windows } from '@/components/city-scenes/kit';
import { Defs, Person, Storefront, type Pose } from '@/components/city-scenes/people';
import { StageRail } from '@/components/request-object';
import { useReducedMotion } from '@/lib/motion';
import './how-film.css';

// A short illustrated film for «كيف تعمل البوابة»: one request, from choosing
// a service to completion. Motion is CSS only (transform/opacity); each scene
// remounts so its animations start fresh, and the progress bar of the current
// scene decides when to move on, so pausing stops everything together.
// Data shown is illustrative (the reference number is an example).

const P = 'hf';
const REF = 'HBS-2026-00041';

type Scene = { title: string; text: string; seconds: number; rail: number | null; pose: Pose };
const scenes: Scene[] = [
  { title: 'اختر الخدمة', text: 'تبحث في دليل الخدمات وتختار ما تحتاجه، ثم تكتب تفاصيل طلبك وتراجعها.', seconds: 4.4, rail: null, pose: 'phone' },
  { title: 'أرسل الطلب', text: 'يصل الطلب إلى المكتب فورًا برقم مرجعي، وحالته «تم الاستلام».', seconds: 4.4, rail: 0, pose: 'talk' },
  { title: 'المكتب يراجع', text: 'يعمل فريق المكتب على طلبك، وتتحدّث الحالة في حسابك أولًا بأول.', seconds: 4.4, rail: 1, pose: 'phone' },
  { title: 'عند الحاجة إليك', text: 'إن احتاج المكتب مستندًا يصلك تنبيه، فترفعه من صفحة الطلب نفسها.', seconds: 5.2, rail: 2, pose: 'phone' },
  { title: 'اكتمل الطلب', text: 'تصبح الحالة «مكتملة» ويصلك بريد بذلك، ويبقى الطلب في سجلك.', seconds: 4.6, rail: 3, pose: 'talk' },
];

// Office and client positions in the 960 × 540 stage.
const OFFICE = { x: 235, g: 452, s: 2.1 };
const CLIENT = { x: 742, g: 480 };

const far = blocks(71, -20, 980, 110, 280, 34, 70);
const near = blocks(29, -20, 980, 50, 150, 40, 90, [[40, 420]]);

function Bubble({ x, y, text, delay, tail = 'center', tone = 'light' }: { x: number; y: number; text: string; delay: number; tail?: 'left' | 'right' | 'center'; tone?: 'light' | 'copper' }) {
  const w = Math.round(text.length * 7.7 + 34);
  const h = 34;
  const tx = tail === 'right' ? x + w / 2 - 26 : tail === 'left' ? x - w / 2 + 26 : x;
  const fill = tone === 'copper' ? '#e5a27b' : '#f6efe3';
  return (
    <g className="hf-pop" style={{ animationDelay: `${delay}s` }}>
      <rect x={x - w / 2} y={y - h} width={w} height={h} rx="15" fill={fill} />
      <path d={`M${tx - 7} ${y - 1} L${tx} ${y + 9} L${tx + 7} ${y - 1}Z`} fill={fill} />
      <text x={x} y={y - 11} textAnchor="middle" direction="rtl" className="hf-text">{text}</text>
    </g>
  );
}

function Badge({ x, y, text, delay, tone = 'teal' }: { x: number; y: number; text: string; delay: number; tone?: 'teal' | 'ok' | 'warn' }) {
  const w = Math.round(text.length * 7.2 + 40);
  const colors = { teal: ['#10292c', '#8fd0c6'], ok: ['#173a2a', '#9fd9b0'], warn: ['#3b2d0c', '#ecd08a'] }[tone];
  return (
    <g className="hf-pop" style={{ animationDelay: `${delay}s` }}>
      <rect x={x - w / 2} y={y - 17} width={w} height={34} rx="17" fill={colors[0]} stroke={colors[1]} strokeOpacity=".6" />
      <circle cx={x + w / 2 - 17} cy={y} r="4" fill={colors[1]} />
      <text x={x - 6} y={y + 5} textAnchor="middle" direction="rtl" className="hf-badge" fill={colors[1]}>{text}</text>
    </g>
  );
}

// A small document card, drawn around (0, 0).
function Doc({ kind = 'form' }: { kind?: 'form' | 'image' }) {
  return (
    <g>
      <rect x="-22" y="-28" width="44" height="56" rx="5" fill="#f6efe3" />
      <path d="M-22 -18 H22" stroke="#e5a27b" strokeWidth="3" />
      {kind === 'image'
        ? <g><rect x="-14" y="-8" width="28" height="20" rx="2" fill="#cfe3de" /><path d="M-14 10 L-4 0 L4 7 L8 3 L14 9 V12 H-14Z" fill="#5b9c95" /><circle cx="7" cy="-2" r="2.6" fill="#e5a27b" /></g>
        : <path d="M-14 -6 H14 M-14 2 H10 M-14 10 H12 M-14 18 H4" stroke="#8a9a96" strokeWidth="2" strokeLinecap="round" />}
    </g>
  );
}

function Envelope() {
  return (
    <g>
      <rect x="-24" y="-16" width="48" height="32" rx="4" fill="#f6efe3" />
      <path d="M-24 -14 L0 4 L24 -14" fill="none" stroke="#a3502f" strokeWidth="2.4" strokeLinejoin="round" />
    </g>
  );
}

function Check({ size = 30 }: { size?: number }) {
  return (
    <g>
      <circle r={size} fill="#2f6446" />
      <circle r={size} fill="none" stroke="#9fd9b0" strokeOpacity=".6" strokeWidth="2" />
      <path d={`M${-size * .42} 0 L${-size * .1} ${size * .32} L${size * .45} ${-size * .3}`} fill="none" stroke="#f6efe3" strokeWidth={size * .16} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

// What changes in each scene, drawn over the shared street.
function SceneLayer({ index }: { index: number }) {
  const bubbleX = CLIENT.x - 10;
  const bubbleY = 238;
  switch (index) {
    case 0:
      return <g>
        <path d="M752 336 L610 150 L610 400Z" fill="#bfeee6" opacity=".06" className="hf-fade" />
        <g className="hf-phone" transform="translate(540 275)">
          <g className="hf-phone-in">
            <rect x="-78" y="-140" width="156" height="262" rx="22" fill="#0b1d20" stroke="#376064" strokeWidth="2" />
            <rect x="-24" y="-130" width="48" height="6" rx="3" fill="#1f3a3d" />
            <text x="0" y="-98" textAnchor="middle" direction="rtl" className="hf-ui hf-ui--head">دليل الخدمات</text>
            <rect x="-62" y="-84" width="124" height="22" rx="11" fill="#10292c" stroke="#376064" />
            <text x="48" y="-68.5" textAnchor="start" direction="rtl" className="hf-ui hf-ui--dim">ابحث عن خدمة…</text>
            <g className="hf-pick"><rect x="-66" y="-50" width="132" height="38" rx="10" fill="#e5a27b" opacity=".22" stroke="#e5a27b" strokeOpacity=".7" /></g>
            {['تجديد إقامة', 'تأسيس شركة', 'إدارة المنصات'].map((label, i) => (
              <text key={label} x="54" y={-25 + i * 46} textAnchor="start" direction="rtl" className="hf-ui">{label}</text>
            ))}
            <g className="hf-pop" style={{ animationDelay: '2.1s' }} transform="translate(-44 17)"><circle r="9" fill="#2f6446" /><path d="M-4 0 L-1 3.4 L4.4 -3" fill="none" stroke="#f6efe3" strokeWidth="2" strokeLinecap="round" /></g>
            <g className="hf-cta" style={{ animationDelay: '2.8s' }}>
              <rect x="-58" y="76" width="116" height="30" rx="15" fill="#f6efe3" />
              <text x="0" y="96" textAnchor="middle" direction="rtl" className="hf-ui hf-ui--btn">متابعة الطلب</text>
            </g>
          </g>
        </g>
        <Bubble x={bubbleX + 40} y={bubbleY} text="أختار الخدمة من الدليل" delay={0.3} tail="left" />
      </g>;
    case 1:
      return <g>
        <Bubble x={bubbleX + 30} y={bubbleY} text="أرسلت الطلب" delay={0.1} tail="left" />
        <g transform="translate(700 330)"><g className="hf-fly hf-fly--to-office"><Doc /></g></g>
        <rect x="282" y="351" width="86" height="100" fill="#ffd9a8" className="hf-flash" style={{ animationDelay: '1.9s' }} />
        <Badge x={OFFICE.x} y={232} text={`${REF} · تم الاستلام`} delay={2.1} />
      </g>;
    case 2:
      return <g>
        <rect x="96" y="351" width="164" height="84" fill="#ffd9a8" className="hf-breath" />
        <g transform="translate(150 392)"><g className="hf-scan">
          <circle r="15" fill="#bfeee6" fillOpacity=".25" stroke="#0e2629" strokeWidth="4" />
          <path d="M11 11 L22 22" stroke="#0e2629" strokeWidth="6" strokeLinecap="round" />
        </g></g>
        <Bubble x={OFFICE.x - 20} y={250} text="نراجع طلبك الآن" delay={0.5} tail="left" />
        <g transform="translate(750 342)"><circle r="16" fill="none" stroke="#8fd0c6" strokeWidth="2.5" className="hf-ping" style={{ animationDelay: '1.9s' }} /></g>
        <Bubble x={bubbleX + 40} y={bubbleY} text="الحالة: قيد المراجعة" delay={2.2} tail="left" tone="copper" />
      </g>;
    case 3:
      return <g>
        <g transform="translate(300 300)"><g className="hf-fly hf-fly--to-client">
          <circle r="22" fill="#3b2d0c" stroke="#ecd08a" strokeWidth="2" />
          <path d="M-8 5 Q-8 -9 0 -10 Q8 -9 8 5 L10 7 H-10Z M-3 9 Q0 13 3 9" fill="#ecd08a" />
        </g></g>
        <Bubble x={bubbleX + 50} y={bubbleY} text="المكتب يحتاج صورة الإقامة" delay={1.4} tail="left" />
        <g transform="translate(700 336)"><g className="hf-fly hf-fly--to-office" style={{ animationDelay: '2.6s' }}><Doc kind="image" /></g></g>
        <rect x="282" y="351" width="86" height="100" fill="#ffd9a8" className="hf-flash" style={{ animationDelay: '4.2s' }} />
        <Badge x={OFFICE.x} y={232} text="وصل المستند" delay={4.3} />
      </g>;
    default:
      return <g>
        <g transform={`translate(${OFFICE.x} 222)`}><g className="hf-pop hf-pop--big" style={{ animationDelay: '.3s' }}><Check size={32} /></g></g>
        <g transform="translate(300 300)"><g className="hf-fly hf-fly--to-client" style={{ animationDelay: '1.2s' }}><Envelope /></g></g>
        <Bubble x={bubbleX + 40} y={bubbleY} text="وصلني بريد: اكتمل طلبك" delay={2.7} tail="left" />
        {[[-70, -30], [60, -44], [-40, 40], [70, 30]].map(([dx, dy], i) => (
          <circle key={i} cx={OFFICE.x + dx} cy={222 + dy} r="3" fill="#e5a27b" className="hf-spark" style={{ animationDelay: `${0.5 + i * .08}s` }} />
        ))}
      </g>;
  }
}

function Street({ pose }: { pose: Pose }) {
  return (
    <>
      <defs>
        <linearGradient id="hf-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a2124" /><stop offset=".42" stopColor="#1f3438" /><stop offset=".66" stopColor="#4d3c43" /><stop offset=".84" stopColor="#a86f55" />
        </linearGradient>
        <linearGradient id="hf-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1a2426" /><stop offset="1" stopColor="#0b1416" /></linearGradient>
        <radialGradient id="hf-lamp"><stop offset="0" stopColor="#ffd9a8" stopOpacity=".5" /><stop offset="1" stopColor="#ffd9a8" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="960" height="540" fill="url(#hf-sky)" />
      <g transform="scale(.6)"><Stars seed={12} count={50} /></g>
      <ellipse cx="300" cy="300" rx="420" ry="60" fill="#e5a27b" opacity=".07" />
      <circle cx="840" cy="86" r="17" fill="#f6efe3" opacity=".85" /><circle cx="848" cy="80" r="15" fill="#274044" />
      <g opacity=".75"><Skyline list={far} ground={452} fill="#1b3033" /></g>
      <g fill="#ffcf96" opacity=".45"><Windows list={far} seed={5} ground={452} density={.1} /></g>
      <Skyline list={near} ground={452} fill="#132326" />
      <g fill="#ffcf96" opacity=".6"><Windows list={near} seed={9} ground={452} density={.14} /></g>
      <Palm x={900} ground={456} s={1.5} fill="#0c1a1c" />
      <Palm x={455} ground={452} s={1.15} fill="#0f1f21" />
      <rect y="450" width="960" height="90" fill="url(#hf-ground)" />
      <path d="M0 452 H960" stroke="#f0b28a" strokeOpacity=".25" />
      <path d="M0 500 H960" stroke="#223033" strokeWidth="2" strokeDasharray="26 22" />
      <g><rect x="598" y="300" width="4" height="152" fill="#0e1b1d" /><path d="M600 302 Q600 290 620 290 H628" stroke="#0e1b1d" strokeWidth="4" fill="none" /><circle cx="628" cy="296" r="5" fill="#ffd9a8" /><circle cx="628" cy="300" r="60" fill="url(#hf-lamp)" className="cs-glow" /></g>
      <Storefront p={P} {...OFFICE} />
      <Person kind="najdi" pose={pose} x={CLIENT.x} g={CLIENT.g} s={3.3} flip p={P} />
    </>
  );
}

export function HowFilm() {
  const reduced = useReducedMotion();
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(!reduced);
  const [ended, setEnded] = useState(false);
  const [run, setRun] = useState(0);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => { if (reduced) setPlaying(false); }, [reduced]);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: .35 });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const running = playing && inView && !reduced;
  const current = scenes[scene];

  function next() {
    if (reduced || !playing) return;
    if (scene < scenes.length - 1) { setScene(scene + 1); return; }
    setPlaying(false); setEnded(true);
  }
  function go(index: number) {
    setScene(index); setEnded(false); setRun((r) => r + 1);
    if (!reduced) setPlaying(true);
  }
  function toggle() {
    if (ended) { go(0); return; }
    setPlaying((p) => !p);
  }

  let control: ReactNode;
  if (ended) control = <><RotateCcw size={17} aria-hidden="true" />أعد المشاهدة</>;
  else if (playing) control = <><Pause size={17} aria-hidden="true" />إيقاف مؤقت</>;
  else control = <><Play size={17} aria-hidden="true" />تشغيل</>;

  return (
    <figure ref={ref} className="hf" aria-label="فيلم قصير يوضّح رحلة طلب في البوابة من اختيار الخدمة حتى اكتماله">
      <div className="hf-stage" data-running={running ? 'true' : 'false'} data-still={reduced ? 'true' : undefined}>
        <svg className="hf-svg" viewBox="0 0 960 540" role="img" aria-hidden="true">
          <Defs p={P} />
          <Street pose={current.pose} />
          <g key={`${run}-${scene}`}><SceneLayer index={scene} /></g>
        </svg>
        <div className="hf-top">
          {current.rail === null
            ? <span className="hf-pre">قبل الإرسال</span>
            : <StageRail stage={current.rail} />}
        </div>
        <span className="hf-tag">مشهد توضيحي</span>
      </div>

      <figcaption className="hf-caption" aria-live="polite">
        <span className="hf-step">{scene + 1} / {scenes.length}</span>
        <strong>{current.title}</strong>
        <span>{current.text}</span>
      </figcaption>

      <div className="hf-controls">
        {!reduced && <button type="button" className="hf-play" onClick={toggle}>{control}</button>}
        <ol className="hf-chapters" aria-label="مشاهد الفيلم">
          {scenes.map((s, i) => (
            <li key={s.title}>
              <button type="button" onClick={() => go(i)} aria-current={i === scene ? 'step' : undefined} data-done={i < scene || ((ended || reduced) && i === scene) ? 'true' : undefined}>
                <span className="hf-bar" aria-hidden="true">
                  {i === scene && !ended && !reduced
                    ? <i key={`${run}-${scene}`} className="hf-fill" style={{ animationDuration: `${s.seconds}s`, animationPlayState: running ? 'running' : 'paused' }} onAnimationEnd={next} />
                    : <i className="hf-fill hf-fill--static" />}
                </span>
                <span className="hf-label">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}
