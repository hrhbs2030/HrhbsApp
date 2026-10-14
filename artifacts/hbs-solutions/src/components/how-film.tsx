import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { blocks, Palm, Skyline, Stars, Windows } from '@/components/city-scenes/kit';
import { Defs, Person, Storefront, type Pose } from '@/components/city-scenes/people';
import { StageRail } from '@/components/request-object';
import { milestones, pauses, type PauseKey } from '@/content/milestones';
import { formatNumber } from '@/lib/format';
import { useReducedMotion } from '@/lib/motion';
import './how-film.css';

// A short illustrated film for «كيف تعمل البوابة»: one concrete story. A note
// appears on an establishment's wage file in مُدد; the owner sends it, the
// office finds the cause, asks for one document, submits the correction and
// the note is closed. Motion is CSS only (transform/opacity); each scene
// remounts so its animations start fresh, and the progress bar of the current
// scene decides when to move on, so pausing stops everything together.
// Data shown is illustrative (the reference number and the cause are examples).
// Stage names come from content/milestones.ts, the same list the portal shows.
// Depth: the street is three parallax groups (sky, far blocks, near street)
// that drift slowly and lean a few pixels with a fine pointer, all via CSS
// transforms on SVG groups; the characters breathe, blink and sway; status
// badges count their digits up as they pop in.

const P = 'hf';
const REF = 'HBS-2026-00041';
const [received, reviewing, submitted, completed] = milestones.map((m) => m.label);
const waiting = pauses.waiting_on_customer.label;

// `lines` are what the characters say, in order, with the second each line
// appears. They render as HTML speech bubbles (readable 15px type on solid
// paper) in a reserved band above the heads, positioned on the stage's
// 960 × 540 coordinates, and under 640px as an HTML subtitle strip beneath the
// picture instead (bubbles would not fit a phone-wide stage). Keep each line
// at eight words or fewer: a bubble wraps at 220px and must stay inside the
// band between the stage rail and the heads.
type Line = { text: string; at: number; who?: 'office' | 'status' };
type Scene = { title: string; text: string; seconds: number; rail: number | null; pause?: PauseKey; pose: Pose; lines: Line[] };
const scenes: Scene[] = [
  { title: 'ظهرت ملاحظة', text: 'تظهر على ملف الأجور في مُدد ملاحظة لا تعرف سببها، فتبحث في دليل الخدمات وتختار متابعة الالتزام بحماية الأجور.', seconds: 4.4, rail: null, pose: 'phone',
    lines: [{ text: 'ظهرت ملاحظة على ملف الأجور', at: 0.3 }] },
  { title: 'أرسل الملاحظة', text: `تكتب الملاحظة كما ظهرت لك مع تاريخها، فيصل الطلب إلى المكتب فورًا برقم مرجعي وحالته «${received}».`, seconds: 4.4, rail: 0, pose: 'talk',
    lines: [{ text: 'أرسلت الملاحظة كما ظهرت لي', at: 0.1 }, { text: `${REF} · ${received}`, at: 2.1, who: 'status' }] },
  { title: 'المكتب يحدد السبب', text: 'يفحص المكتب ما يظهر على منشأتك في مُدد ويحدد سبب الملاحظة، وتقرأ تفسيره في محادثة الطلب.', seconds: 4.4, rail: 1, pose: 'phone',
    lines: [{ text: 'السبب: أجر موظف يخالف عقده', at: 0.5, who: 'office' }, { text: `الحالة: ${reviewing}`, at: 2.2, who: 'status' }] },
  { title: 'مستند واحد منك', text: `يحتاج المكتب كشف رواتب ذلك الشهر، فتصبح الحالة «${waiting}» ويصلك تنبيه، وترفعه من قائمة المستندات في الطلب نفسه.`, seconds: 5.2, rail: 1, pause: 'waiting_on_customer', pose: 'phone',
    lines: [{ text: 'المكتب يطلب كشف رواتب الشهر', at: 1.4 }, { text: 'وصل كشف الرواتب', at: 4.3, who: 'status' }] },
  { title: 'رُفع التصحيح', text: `يعدّ المكتب التصحيح ويرفعه إلى الجهة المختصة ويتابعه، والحالة «${submitted}».`, seconds: 4.4, rail: 2, pose: 'talk',
    lines: [{ text: 'رفعنا التصحيح للجهة المختصة ونتابعه', at: 0.4, who: 'office' }, { text: `الحالة: ${submitted}`, at: 2.3, who: 'status' }] },
  { title: 'أُغلقت الملاحظة', text: `حين تُغلق الملاحظة تصبح الحالة «${completed}» ويصلك بريد بذلك، ويبقى الطلب في سجلك.`, seconds: 4.6, rail: 3, pose: 'talk',
    lines: [{ text: 'وصلني بريد: أُغلقت الملاحظة', at: 2.7 }] },
];

// Office and client positions in the 960 × 540 stage.
const OFFICE = { x: 235, g: 452, s: 2.1 };
const CLIENT = { x: 742, g: 480 };

const far = blocks(71, -20, 980, 110, 280, 34, 70);
const near = blocks(29, -20, 980, 50, 150, 40, 90, [[40, 420]]);

// What the badges need to know about playback: a still frame (reduced motion)
// shows final digits at once; a paused film holds the count where it is.
const FilmContext = createContext({ running: true, still: false });

// Counts the last run of digits in `text` up from zero over `duration` ms,
// starting `delay` s after mount (the badge's pop). Pure React state, one
// rAF loop, so it holds together with the CSS animations around it.
function useCountUp(text: string, delay: number, duration = 700) {
  const { running, still } = useContext(FilmContext);
  const match = text.match(/(\d+)(?!.*\d)/);
  const target = match ? Number(match[1]) : 0;
  const [value, setValue] = useState(still || !match ? target : 0);
  const progress = useRef(0);
  const runningRef = useRef(running);
  runningRef.current = running;
  useEffect(() => {
    if (!match || still) { setValue(target); return; }
    let frame = 0; let last = 0;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      if (!last) last = now;
      if (runningRef.current) progress.current = Math.min(1, progress.current + (now - last) / duration);
      last = now;
      setValue(Math.round(ease(progress.current) * target));
      if (progress.current < 1) frame = requestAnimationFrame(tick);
    };
    const timer = window.setTimeout(() => { frame = requestAnimationFrame(tick); }, delay * 1000);
    return () => { window.clearTimeout(timer); cancelAnimationFrame(frame); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, still]);
  if (!match) return text;
  const digits = String(value).padStart(match[1].length, '0');
  return text.slice(0, match.index) + digits + text.slice((match.index ?? 0) + match[1].length);
}

// Stage coordinates (960 × 540) of each speaker's bubble tail: above the
// client's head and above the office sign, below the stage rail. HTML, so the
// text keeps its 15px size at every stage width; the band above the heads is
// reserved for them and the overlap check in the scratchpad guards it.
const CLIENT_SAY = { x: 745, y: 238 };
const OFFICE_SAY = { x: 235, y: 250 };
const stagePos = (x: number, y: number): CSSProperties => ({ '--x': `${(x / 960 * 100).toFixed(2)}%`, '--y': `${((540 - y) / 540 * 100).toFixed(2)}%` } as CSSProperties);

function Bubble({ x, y, text, delay, tone = 'light' }: { x: number; y: number; text: string; delay: number; tone?: 'light' | 'copper' }) {
  return <span className={`hf-say hf-say--${tone}`} style={{ ...stagePos(x, y), animationDelay: `${delay}s` }}>{text}</span>;
}

function Badge({ x, y, text, delay, tone = 'teal' }: { x: number; y: number; text: string; delay: number; tone?: 'teal' | 'ok' | 'warn' }) {
  const shown = useCountUp(text, delay + .15);
  return (
    <span className={`hf-badge hf-badge--${tone}`} style={{ ...stagePos(x, y), animationDelay: `${delay}s` }}>
      <i className="hf-dot" style={{ animationDelay: `${delay + .4}s` }} aria-hidden="true" />{shown}
    </span>
  );
}

// The words of a scene: speech bubbles and status badges, an HTML layer over
// the picture (same `lines`, same seconds as the subtitle strip).
function SceneWords({ index }: { index: number }) {
  const L = scenes[index].lines;
  switch (index) {
    case 0: return <Bubble {...CLIENT_SAY} text={L[0].text} delay={L[0].at} />;
    case 1: return <><Bubble {...CLIENT_SAY} text={L[0].text} delay={L[0].at} /><Badge {...OFFICE_SAY} text={L[1].text} delay={L[1].at} /></>;
    case 2: return <><Bubble {...OFFICE_SAY} text={L[0].text} delay={L[0].at} /><Bubble {...CLIENT_SAY} text={L[1].text} delay={L[1].at} tone="copper" /></>;
    case 3: return <><Bubble {...CLIENT_SAY} text={L[0].text} delay={L[0].at} /><Badge {...OFFICE_SAY} text={L[1].text} delay={L[1].at} /></>;
    case 4: return <><Bubble {...OFFICE_SAY} text={L[0].text} delay={L[0].at} /><Bubble {...CLIENT_SAY} text={L[1].text} delay={L[1].at} tone="copper" /></>;
    default: return <Bubble {...CLIENT_SAY} text={L[0].text} delay={L[0].at} />;
  }
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
            <text x="48" y="-68.5" textAnchor="start" direction="rtl" className="hf-ui hf-ui--query">ملاحظة ملف الأجور</text>
            <g className="hf-pick"><rect x="-66" y="-50" width="132" height="38" rx="10" fill="#e5a27b" opacity=".22" stroke="#e5a27b" strokeOpacity=".7" /></g>
            {['متابعة الالتزام', 'حماية الأجور', 'ملفات الرواتب'].map((label, i) => (
              <text key={label} x="54" y={-25 + i * 46} textAnchor="start" direction="rtl" className="hf-ui">{label}</text>
            ))}
            <g className="hf-pop" style={{ animationDelay: '2.1s' }} transform="translate(-44 17)"><circle r="9" fill="#2f6446" /><path d="M-4 0 L-1 3.4 L4.4 -3" fill="none" stroke="#f6efe3" strokeWidth="2" strokeLinecap="round" /></g>
            <g className="hf-cta" style={{ animationDelay: '2.8s' }}>
              <rect x="-58" y="76" width="116" height="30" rx="15" fill="#f6efe3" />
              <text x="0" y="96" textAnchor="middle" direction="rtl" className="hf-ui hf-ui--btn">متابعة الطلب</text>
            </g>
          </g>
        </g>
      </g>;
    case 1:
      return <g>
        <g transform="translate(700 330)"><g className="hf-fly hf-fly--to-office"><Doc /></g></g>
        <rect x="282" y="351" width="86" height="100" fill="#ffd9a8" className="hf-flash" style={{ animationDelay: '1.9s' }} />
      </g>;
    case 2:
      return <g>
        <rect x="96" y="351" width="164" height="84" fill="#ffd9a8" className="hf-breath" />
        <g transform="translate(150 392)"><g className="hf-scan">
          <circle r="15" fill="#bfeee6" fillOpacity=".25" stroke="#0e2629" strokeWidth="4" />
          <path d="M11 11 L22 22" stroke="#0e2629" strokeWidth="6" strokeLinecap="round" />
        </g></g>
        <g transform="translate(750 342)"><circle r="16" fill="none" stroke="#8fd0c6" strokeWidth="2.5" className="hf-ping" style={{ animationDelay: '1.9s' }} /></g>
      </g>;
    case 3:
      return <g>
        <g transform="translate(300 300)"><g className="hf-fly hf-fly--to-client">
          <circle r="22" fill="#3b2d0c" stroke="#ecd08a" strokeWidth="2" />
          <path d="M-8 5 Q-8 -9 0 -10 Q8 -9 8 5 L10 7 H-10Z M-3 9 Q0 13 3 9" fill="#ecd08a" />
        </g></g>
        <g transform="translate(700 336)"><g className="hf-fly hf-fly--to-office" style={{ animationDelay: '2.6s' }}><Doc kind="image" /></g></g>
        <rect x="282" y="351" width="86" height="100" fill="#ffd9a8" className="hf-flash" style={{ animationDelay: '4.2s' }} />
      </g>;
    case 4:
      // The file leaves the office upward, towards the authority off-stage.
      return <g>
        <g transform={`translate(${OFFICE.x} 300)`}><g className="hf-fly hf-fly--up" style={{ animationDelay: '.2s' }}><Doc /></g></g>
        <g transform="translate(750 342)"><circle r="16" fill="none" stroke="#8fd0c6" strokeWidth="2.5" className="hf-ping" style={{ animationDelay: '2s' }} /></g>
      </g>;
    default:
      return <g>
        <g transform={`translate(${OFFICE.x} 222)`}><g className="hf-pop hf-pop--big" style={{ animationDelay: '.3s' }}><Check size={32} /></g></g>
        <g transform="translate(300 300)"><g className="hf-fly hf-fly--to-client" style={{ animationDelay: '1.2s' }}><Envelope /></g></g>
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
        <linearGradient id="hf-haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4d3c43" stopOpacity="0" /><stop offset=".55" stopColor="#a86f55" stopOpacity=".22" /><stop offset="1" stopColor="#a86f55" stopOpacity=".05" /></linearGradient>
        {/* Rim light: a warm, slightly blurred edge around each figure's silhouette so it separates from the night street. */}
        <filter id="hf-rim" x="-12%" y="-6%" width="124%" height="112%" colorInterpolationFilters="sRGB">
          <feMorphology in="SourceAlpha" operator="dilate" radius="1.7" result="d" />
          <feGaussianBlur in="d" stdDeviation="1.1" result="b" />
          <feFlood floodColor="#ffd9a8" floodOpacity=".75" />
          <feComposite in2="b" operator="in" result="rim" />
          <feMerge><feMergeNode in="rim" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="hf-backlight" cx=".5" cy=".55" r=".5"><stop offset="0" stopColor="#ffd9a8" stopOpacity=".34" /><stop offset=".6" stopColor="#ffb87a" stopOpacity=".1" /><stop offset="1" stopColor="#ffb87a" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="960" height="540" fill="url(#hf-sky)" />
      {/* Sky: stars and moon, the deepest layer (least movement). */}
      <g className="hf-par hf-par--sky"><g className="hf-drift hf-drift--sky">
        <g transform="scale(.6)"><Stars seed={12} count={50} /></g>
        <ellipse cx="300" cy="300" rx="420" ry="60" fill="#e5a27b" opacity=".07" />
        <circle cx="840" cy="86" r="17" fill="#f6efe3" opacity=".85" /><circle cx="848" cy="80" r="15" fill="#274044" />
      </g></g>
      {/* Far blocks, under a thin haze that softens them into the sky. */}
      <g className="hf-par hf-par--far"><g className="hf-drift hf-drift--far">
        <g opacity=".75"><Skyline list={far} ground={452} fill="#1b3033" /></g>
        <g fill="#ffcf96" opacity=".45"><Windows list={far} seed={5} ground={452} density={.1} /></g>
        <rect x="-40" y="300" width="1040" height="160" fill="url(#hf-haze)" className="hf-haze" />
      </g></g>
      {/* Near street: the stage everyone stands on (most movement). */}
      <g className="hf-par hf-par--near"><g className="hf-drift hf-drift--near">
        <Skyline list={near} ground={452} fill="#132326" />
        <g fill="#ffcf96" opacity=".6"><Windows list={near} seed={9} ground={452} density={.14} /></g>
        <Palm x={900} ground={456} s={1.5} fill="#0c1a1c" />
        <Palm x={455} ground={452} s={1.15} fill="#0f1f21" />
        <rect y="450" width="960" height="90" fill="url(#hf-ground)" />
        <path d="M0 452 H960" stroke="#f0b28a" strokeOpacity=".25" />
        <path d="M0 500 H960" stroke="#223033" strokeWidth="2" strokeDasharray="26 22" />
        <g><rect x="598" y="300" width="4" height="152" fill="#0e1b1d" /><path d="M600 302 Q600 290 620 290 H628" stroke="#0e1b1d" strokeWidth="4" fill="none" /><circle cx="628" cy="296" r="5" fill="#ffd9a8" /><circle cx="628" cy="300" r="60" fill="url(#hf-lamp)" className="cs-glow" /></g>
        <g className="hf-office" filter="url(#hf-rim)"><Storefront p={P} {...OFFICE} /></g>
        {/* A warm pool of light behind the client, then the figure with its rim. */}
        <ellipse cx={CLIENT.x} cy={CLIENT.g - 110} rx="150" ry="150" fill="url(#hf-backlight)" />
        <g className="hf-sway"><g className="hf-client" filter="url(#hf-rim)"><Person kind="najdi" pose={pose} x={CLIENT.x} g={CLIENT.g} s={3.3} flip p={P} /></g></g>
      </g></g>
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
  const stageRef = useRef<HTMLDivElement>(null);

  // Pointer parallax on fine pointers only: the three street groups lean a
  // few pixels toward the cursor, written as CSS variables once per frame.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || reduced || typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: fine)').matches) return;
    let frame = 0;
    let next: [number, number] | null = null;
    const apply = () => {
      frame = 0;
      if (!next) return;
      stage.style.setProperty('--hpx', next[0].toFixed(3));
      stage.style.setProperty('--hpy', next[1].toFixed(3));
    };
    const onMove = (event: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      next = [(event.clientX - rect.left) / rect.width - .5, (event.clientY - rect.top) / rect.height - .5];
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => { next = [0, 0]; if (!frame) frame = requestAnimationFrame(apply); };
    stage.addEventListener('pointermove', onMove, { passive: true });
    stage.addEventListener('pointerleave', onLeave);
    return () => { stage.removeEventListener('pointermove', onMove); stage.removeEventListener('pointerleave', onLeave); cancelAnimationFrame(frame); };
  }, [reduced]);

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
  if (ended) control = <><RotateCcw size={18} strokeWidth={1.75} aria-hidden="true" />أعد المشاهدة</>;
  else if (playing) control = <><Pause size={18} strokeWidth={1.75} aria-hidden="true" />إيقاف مؤقت</>;
  else control = <><Play size={18} strokeWidth={1.75} aria-hidden="true" />تشغيل</>;

  return (
    <figure ref={ref} className="hf" aria-label="فيلم قصير يوضّح معالجة ملاحظة على ملف الأجور عبر البوابة، من إرسالها حتى إغلاقها">
      <div className="hf-stage" ref={stageRef} data-running={running ? 'true' : 'false'} data-still={reduced ? 'true' : undefined} style={{ '--hpx': 0, '--hpy': 0 } as CSSProperties}>
        <div className="hf-frame">
          {/* Phones crop the sides of the picture (xMidYMax slice) so the figures stay large. */}
          <svg className="hf-svg" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice" role="img" aria-hidden="true">
            <Defs p={P} />
            <Street pose={current.pose} />
            <g key={`${run}-${scene}`}><SceneLayer index={scene} /></g>
          </svg>
          {/* Speech bubbles and status badges: HTML in the band above the heads. */}
          <FilmContext.Provider value={{ running, still: reduced }}>
            <div className="hf-words" aria-hidden="true" key={`words-${run}-${scene}`}><SceneWords index={scene} /></div>
          </FilmContext.Provider>
          <div className="hf-top">
            {current.rail === null
              ? <span className="hf-pre">قبل الإرسال</span>
              : <StageRail stage={current.rail} pause={current.pause} />}
          </div>
          <span className="hf-tag">مشهد توضيحي</span>
        </div>
        {/* Phone-size subtitles: the same lines as the bubbles, in a strip under the picture. */}
        <div className="hf-subs" aria-hidden="true" key={`subs-${run}-${scene}`}>
          {current.lines.map((line) => (
            <span key={line.text} className={`hf-sub${line.who ? ` hf-sub--${line.who}` : ''}`} style={{ animationDelay: `${line.at}s` }}>{line.text}</span>
          ))}
        </div>
      </div>

      <figcaption className="hf-caption" aria-live="polite">
        <span className="hf-step nums" dir="ltr">{formatNumber(scene + 1)} / {formatNumber(scenes.length)}</span>
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
