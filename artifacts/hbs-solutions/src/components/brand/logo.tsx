import { useId, type CSSProperties } from 'react';
import './logo.css';

// HBS mark: an "H" whose crossbar is a horizon, with the sun of tomorrow
// (الغد) rising between its pillars. The same geometry is used by the
// favicon (public/favicon.svg), the intro animation and the print watermark.
// Keep the three in sync if the drawing changes.

export function LogoMark({ size = 44, className = '', title }: { size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`logo-mark ${className}`} width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1d5a60" /><stop offset="1" stopColor="#0c2a2d" /></linearGradient>
        <linearGradient id={`${id}-sun`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f6c49f" /><stop offset="1" stopColor="#d9804f" /></linearGradient>
        <clipPath id={`${id}-sky`}><rect x="0" y="0" width="64" height="35" /></clipPath>
      </defs>
      <rect className="logo-mark-bg" width="64" height="64" rx="15" fill={`url(#${id}-bg)`} />
      <rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="#fff" strokeOpacity=".12" />
      <g clipPath={`url(#${id}-sky)`}><circle className="logo-mark-sun" cx="32" cy="35" r="9.5" fill={`url(#${id}-sun)`} /></g>
      <rect className="logo-mark-pillar logo-mark-pillar--a" x="14" y="15" width="7" height="34" rx="2.5" fill="#f6efe3" />
      <rect className="logo-mark-pillar logo-mark-pillar--b" x="43" y="15" width="7" height="34" rx="2.5" fill="#f6efe3" />
      <rect className="logo-mark-bar" x="14" y="35" width="36" height="4.5" rx="2" fill="#f6efe3" />
    </svg>
  );
}

// Full lockup: mark, "HBS", divider, "حلول الغد". `tone` sets the word colour.
export function Logo({ tone = 'dark', size = 44, tagline = false, className = '', style }: { tone?: 'dark' | 'light'; size?: number; tagline?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <span className={`logo logo--${tone} ${className}`} style={{ '--logo-size': `${size}px`, ...style } as CSSProperties}>
      <LogoMark size={size} />
      <span className="logo-words">
        <span className="logo-line"><b className="logo-latin" dir="ltr">HBS</b><i className="logo-sep" aria-hidden="true" /><span className="logo-ar">حلول الغد</span></span>
        {tagline && <small className="logo-tag">خدمات المكتب الإلكترونية</small>}
      </span>
    </span>
  );
}
