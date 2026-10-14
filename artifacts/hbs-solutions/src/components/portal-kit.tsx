import { useEffect, type CSSProperties, type ElementType, type HTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowUpLeft, Inbox, Minus, Search, TrendingDown, TrendingUp, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import './ui-portal.css';
import './portal-kit.css';

// Portal primitives with no Clerk or API dependency. Pages may import them
// from here directly (the page tests mock `portal-ui`, not this module) or
// through portal-ui, which re-exports everything.

/* ------------------------------------------------------------------ Surface */
export type SurfaceTier = 'card' | 'panel' | 'raised' | 'sunk' | 'night';
export type SurfaceProps = HTMLAttributes<HTMLElement> & { as?: ElementType; tier?: SurfaceTier; hover?: boolean; padding?: 'none' | 'sm' | 'md' | 'lg' };
const surfacePadding = { none: '', sm: 'p-4', md: 'p-5 sm:p-6', lg: 'p-6 sm:p-8' };
// One card/panel system: `tier` picks the surface, `hover` adds the lift, `padding` the inner space.
export function Surface({ as: Tag = 'div', tier = 'card', hover = false, padding = 'md', className = '', ...rest }: SurfaceProps) {
  const base = tier === 'card' ? 'surface' : `surface-${tier}`;
  return <Tag className={`${base} ${hover ? 'surface-hover' : ''} ${surfacePadding[padding]} ${className}`.replace(/\s+/g, ' ').trim()} {...rest} />;
}

/* ------------------------------------------------------------- SectionHeader */
// Title row above a card or list: heading + optional eyebrow, count chip, description and an action slot.
export function SectionHeader({ title, description, eyebrow, count, action, as: Tag = 'h2', id, className = '' }: { title: ReactNode; description?: ReactNode; eyebrow?: ReactNode; count?: number | string; action?: ReactNode; as?: 'h1' | 'h2' | 'h3' | 'h4'; id?: string; className?: string }) {
  return <div className={`kit-section-head ${className}`}>
    <div className="min-w-0">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <div className="flex items-center gap-2"><Tag id={id} className="kit-section-title display">{title}</Tag>{count !== undefined && <span className="chip chip-sm nums" aria-label={`${count} عنصر`}>{count}</span>}</div>
      {description && <p className="kit-section-desc">{description}</p>}
    </div>
    {action && <div className="kit-section-action">{action}</div>}
  </div>;
}

/* --------------------------------------------------------------------- Chip */
export type ChipTone = 'neutral' | 'ok' | 'warn' | 'info' | 'danger' | 'accent' | 'teal' | 'outline' | 'dark';
// Small label: `tone` colours it, `dot` adds a status dot, `size="sm"` for dense tables.
export function Chip({ tone = 'neutral', dot = false, size = 'md', icon, className = '', children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone; dot?: boolean; size?: 'md' | 'sm'; icon?: ReactNode }) {
  return <span className={`chip ${tone === 'neutral' ? '' : `chip-${tone}`} ${dot ? 'chip-dot' : ''} ${size === 'sm' ? 'chip-sm' : ''} ${className}`.replace(/\s+/g, ' ').trim()} {...rest}>{icon}{children}</span>;
}
// Toggle chip for filters: `aria-pressed` carries the state; `count` shows a trailing number.
export function FilterChip({ active = false, count, className = '', children, ...rest }: Omit<HTMLAttributes<HTMLButtonElement>, 'children'> & { active?: boolean; count?: number | string; children: ReactNode }) {
  return <button type="button" className={`chip chip-select ${className}`} aria-pressed={active} {...rest}>{children}{count !== undefined && <span className="nums opacity-80">{count}</span>}</button>;
}

/* --------------------------------------------------------------------- Tile */
export type TileTone = 'default' | 'accent' | 'warn' | 'ok' | 'danger';
export type TileTrend = { direction: 'up' | 'down' | 'flat'; value: string; label?: string; good?: boolean };
export type TileProps = {
  label: ReactNode; value: ReactNode; note?: ReactNode; href?: string; onClick?: () => void;
  tone?: TileTone; accent?: boolean; warn?: boolean; long?: boolean; loading?: boolean;
  trend?: TileTrend; spark?: ReactNode; icon?: ReactNode; className?: string; testId?: string;
};
// KPI tile: label, big number, note; optional link, trend arrow (`good` colours it) and a sparkline slot.
export function Tile({ label, value, note, href, onClick, tone = 'default', accent = false, warn = false, long = false, loading = false, trend, spark, icon, className = '', testId }: TileProps) {
  const resolved: TileTone = accent ? 'accent' : warn ? 'warn' : tone;
  const good = trend ? (trend.good ?? trend.direction !== 'down') : true;
  const TrendIcon = trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : Minus;
  const body = loading ? <>
    <div className="skeleton h-3 w-2/5" /><div className="skeleton mt-4 h-8 w-3/5" /><div className="skeleton mt-3 h-3 w-1/3" />
  </> : <>
    <div className="kit-tile-label">{icon && <span className="kit-tile-icon" aria-hidden="true">{icon}</span>}<span className="min-w-0 truncate">{label}</span>{href && <ArrowUpLeft size={15} className="kit-tile-arrow" aria-hidden="true" />}</div>
    <div className="kit-tile-row">
      <div className={`kit-tile-value display nums ${long ? 'kit-tile-value--long' : ''}`}>{value}</div>
      {spark && <div className="kit-tile-spark" aria-hidden="true">{spark}</div>}
    </div>
    {(note || trend) && <div className="kit-tile-foot">
      {trend && <span className={`kit-tile-trend ${trend.direction === 'flat' ? 'is-flat' : good ? 'is-good' : 'is-bad'}`}><TrendIcon size={14} strokeWidth={2.2} aria-hidden="true" /><span className="nums">{trend.value}</span>{trend.label && <span className="kit-tile-trend-label">{trend.label}</span>}</span>}
      {note && <span className="kit-tile-note">{note}</span>}
    </div>}
  </>;
  const classes = `kit-tile kit-tile--${resolved} ${href || onClick ? 'kit-tile--link' : ''} ${className}`.replace(/\s+/g, ' ').trim();
  if (href) return <Link href={href} className={classes} data-testid={testId} aria-busy={loading || undefined}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={classes} data-testid={testId} aria-busy={loading || undefined}>{body}</button>;
  return <div className={classes} data-testid={testId} aria-busy={loading || undefined}>{body}</div>;
}
// Responsive grid for tiles: 2 columns on phones, 4 from 1024px (`cols` caps it).
export function TileGrid({ cols = 4, className = '', children }: { cols?: 2 | 3 | 4; className?: string; children: ReactNode }) {
  return <div className={`kit-tile-grid kit-tile-grid--${cols} ${className}`}>{children}</div>;
}

/* ------------------------------------------------------------------ Toolbar */
export type ToolbarSearch = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onChange: (value: string) => void; label?: string };
// Filters + search + actions in one row: search grows, chips wrap, actions sit at the end; `sticky` pins it under the topbar.
export function Toolbar({ search, filters, actions, sticky = false, className = '', children, ...rest }: HTMLAttributes<HTMLDivElement> & { search?: ToolbarSearch; filters?: ReactNode; actions?: ReactNode; sticky?: boolean }) {
  return <div className={`kit-toolbar ${sticky ? 'kit-toolbar--sticky' : ''} ${className}`} role="search" {...rest}>
    {search && <SearchField {...search} />}
    {filters && <div className="kit-toolbar-filters">{filters}</div>}
    {children}
    {actions && <div className="kit-toolbar-actions">{actions}</div>}
  </div>;
}
// Search input with the magnifier and a clear button; `label` is the accessible name.
export function SearchField({ value, onChange, label = 'بحث', placeholder = 'ابحث…', className = '', ...rest }: ToolbarSearch) {
  return <div className={`kit-search ${className}`}>
    <Search size={17} strokeWidth={1.9} className="kit-search-icon" aria-hidden="true" />
    <input type="search" className="form-control kit-search-input" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} placeholder={placeholder} enterKeyHint="search" {...rest} />
    {value && <button type="button" className="kit-search-clear" onClick={() => onChange('')} aria-label="مسح البحث"><X size={15} aria-hidden="true" /></button>}
  </div>;
}

/* ---------------------------------------------------------------- Skeletons */
// One shimmering line; `w`/`h` are CSS lengths.
export function SkeletonLine({ w = '100%', h = 14, className = '' }: { w?: string | number; h?: string | number; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ width: w, height: h }} aria-hidden="true" />;
}
// A paragraph placeholder of `lines` lines, the last one shorter.
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return <div className={`grid gap-2.5 ${className}`} aria-hidden="true">{Array.from({ length: lines }, (_, i) => <SkeletonLine key={i} w={i === lines - 1 ? '60%' : '100%'} />)}</div>;
}
// Table/list placeholder: `rows` rows of `cols` cells.
export function SkeletonRows({ rows = 5, cols = 4, className = '' }: { rows?: number; cols?: number; className?: string }) {
  return <div className={`grid gap-3 ${className}`} aria-hidden="true">{Array.from({ length: rows }, (_, r) => <div key={r} className="flex items-center gap-4">{Array.from({ length: cols }, (_, c) => <SkeletonLine key={c} h={14} w={c === 0 ? '32%' : `${14 + ((r + c) % 3) * 6}%`} />)}</div>)}</div>;
}
// KPI placeholder: `count` loading tiles in the tile grid.
export function SkeletonTiles({ count = 4 }: { count?: number }) {
  return <TileGrid cols={count >= 4 ? 4 : count === 3 ? 3 : 2}>{Array.from({ length: count }, (_, i) => <Tile key={i} label="" value="" loading />)}</TileGrid>;
}

/* --------------------------------------------------------------- EmptyState */
// Empty state for a card or table: icon tile, title, text and one action (link or button).
export function EmptyState({ title, text, action, href, onAction, icon, compact = false, className = '' }: { title: ReactNode; text?: ReactNode; action?: string; href?: string; onAction?: () => void; icon?: ReactNode; compact?: boolean; className?: string }) {
  return <div className={`kit-empty ${compact ? 'kit-empty--compact' : ''} ${className}`}>
    <div className="kit-empty-icon" aria-hidden="true">{icon ?? <Inbox size={compact ? 22 : 28} strokeWidth={1.5} />}</div>
    <h3 className="kit-empty-title display">{title}</h3>
    {text && <p className="kit-empty-text">{text}</p>}
    {action && href && <Link href={href} className="btn btn-primary mt-5">{action}</Link>}
    {action && !href && onAction && <button type="button" onClick={onAction} className="btn btn-primary mt-5">{action}</button>}
  </div>;
}

/* ---------------------------------------------------------------- DataTable */
export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  // Cell renderer; defaults to the row's property named by `key`.
  cell?: (row: T, index: number) => ReactNode;
  align?: 'start' | 'end' | 'center';
  width?: string;
  nums?: boolean;
  // Hide the column under this breakpoint (sm 640, md 768, lg 1024).
  hideBelow?: 'sm' | 'md' | 'lg';
  // The card view (under 640px) shows this cell as the card title.
  primary?: boolean;
  // Text used as the card-view label (defaults to a string header).
  label?: string;
};
export type DataTableProps<T> = {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  skeletonRows?: number;
  empty?: ReactNode;
  caption?: string;
  'aria-label'?: string;
  rowHref?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  rowSelected?: (row: T) => boolean;
  rowTone?: (row: T) => 'warn' | 'danger' | 'ok' | undefined;
  dense?: boolean;
  zebra?: boolean;
  stickyHeader?: boolean;
  footer?: ReactNode;
  className?: string;
  testId?: string;
};
// Data table with sticky header, zebra rows, hover, skeleton and empty states; stacks into cards under 640px.
export function DataTable<T>({ columns, rows, rowKey, loading = false, skeletonRows = 6, empty, caption, rowHref, onRowClick, rowSelected, rowTone, dense = false, zebra = true, stickyHeader = true, footer, className = '', testId, ...rest }: DataTableProps<T>) {
  const [, navigate] = useLocation();
  const interactive = !!(rowHref || onRowClick);
  const activate = (row: T) => { if (onRowClick) onRowClick(row); else { const href = rowHref?.(row); if (href) navigate(href); } };
  const onRowKey = (row: T) => (event: KeyboardEvent<HTMLTableRowElement>) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(row); } };
  const onRowClickCapture = (row: T) => (event: MouseEvent<HTMLTableRowElement>) => {
    // Clicks on inner controls (links, buttons, inputs) keep their own behaviour.
    const target = event.target as HTMLElement; if (target.closest('a, button, input, select, textarea, label, [role="menu"]')) return; activate(row);
  };
  const label = (column: DataColumn<T>) => column.label ?? (typeof column.header === 'string' ? column.header : undefined);
  const cellClass = (column: DataColumn<T>) => `${column.align ? `is-${column.align}` : ''} ${column.nums ? 'nums' : ''} ${column.hideBelow ? `dt-hide-${column.hideBelow}` : ''}`.replace(/\s+/g, ' ').trim();
  const showEmpty = !loading && rows.length === 0;
  return <div className={`dt-wrap ${stickyHeader ? 'dt-wrap--sticky' : ''} ${className}`} data-testid={testId}>
    <table className={`dt ${dense ? 'dt--dense' : ''} ${zebra ? 'dt--zebra' : ''} ${interactive ? 'dt--interactive' : ''}`} aria-busy={loading || undefined} {...rest}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead><tr>{columns.map((column) => <th key={column.key} scope="col" className={cellClass(column)} style={column.width ? { width: column.width } : undefined}>{column.header}</th>)}</tr></thead>
      <tbody>
        {loading && Array.from({ length: skeletonRows }, (_, r) => <tr key={`s${r}`} className="dt-skeleton" aria-hidden="true">{columns.map((column, c) => <td key={column.key} className={cellClass(column)} data-label={label(column)} data-primary={column.primary || undefined}><span className="skeleton block h-3.5" style={{ width: `${c === 0 ? 70 : 35 + ((r + c) % 3) * 15}%` }} /></td>)}</tr>)}
        {!loading && rows.map((row, index) => {
          const href = rowHref?.(row); const selected = rowSelected?.(row); const tone = rowTone?.(row);
          return <tr key={rowKey(row, index)} tabIndex={interactive ? 0 : undefined} aria-selected={selected || undefined} data-selected={selected || undefined} data-tone={tone} onClick={interactive ? onRowClickCapture(row) : undefined} onKeyDown={interactive ? onRowKey(row) : undefined}>
            {columns.map((column) => {
              const content = column.cell ? column.cell(row, index) : String((row as Record<string, unknown>)[column.key] ?? '');
              return <td key={column.key} className={cellClass(column)} data-label={label(column)} data-primary={column.primary || undefined}>{column.primary && href ? <Link href={href} className="dt-primary-link">{content}</Link> : content}</td>;
            })}
          </tr>;
        })}
      </tbody>
      {footer && <tfoot><tr><td colSpan={columns.length}>{footer}</td></tr></tfoot>}
    </table>
    {showEmpty && <div className="dt-empty">{empty ?? <EmptyState compact title="لا توجد نتائج" text="لم نجد ما يطابق بحثك أو تصفيتك." />}</div>}
  </div>;
}

/* ------------------------------------------------------------ Key/value list */
// Definition list for details panels: `items` of {label, value}; `columns` 1 or 2.
export function KeyValueList({ items, columns = 1, className = '' }: { items: { label: ReactNode; value: ReactNode; nums?: boolean }[]; columns?: 1 | 2; className?: string }) {
  return <dl className={`kit-kv kit-kv--${columns} ${className}`}>{items.map((item, index) => <div key={index} className="kit-kv-row"><dt>{item.label}</dt><dd className={item.nums ? 'nums' : ''}>{item.value}</dd></div>)}</dl>;
}

/* ------------------------------------------------------------------- Avatar */
// Initials disc for people and establishments; `tone` matches the surface it sits on.
export function Avatar({ name, size = 36, tone = 'light', className = '', src }: { name?: string | null; size?: number; tone?: 'light' | 'dark'; className?: string; src?: string | null }) {
  const initial = (name ?? '').trim().slice(0, 1) || 'ح';
  const style: CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (src) return <img src={src} alt="" className={`kit-avatar kit-avatar--${tone} ${className}`} style={style} width={size} height={size} />;
  return <span className={`kit-avatar kit-avatar--${tone} ${className}`} style={style} aria-hidden="true">{initial}</span>;
}

/* ------------------------------------------------------------ Dialog/Sheet */
export type DialogFrameProps = { open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg'; className?: string };
const dialogSize = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };
// Centered modal with title/description/footer; Escape, overlay click and the close button all close it.
export function DialogFrame({ open, onOpenChange, title, description, children, footer, size = 'md', className = '' }: DialogFrameProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent dir="rtl" className={`kit-dialog ${dialogSize[size]} ${className}`}>
      <DialogHeader className="kit-dialog-head"><DialogTitle className="display kit-dialog-title">{title}</DialogTitle>{description ? <DialogDescription className="kit-dialog-desc">{description}</DialogDescription> : <DialogDescription className="sr-only">{typeof title === 'string' ? title : 'نافذة'}</DialogDescription>}</DialogHeader>
      <div className="kit-dialog-body">{children}</div>
      {footer && <DialogFooter className="kit-dialog-foot">{footer}</DialogFooter>}
    </DialogContent>
  </Dialog>;
}
export type SheetFrameProps = Omit<DialogFrameProps, 'size'> & { side?: 'start' | 'end' | 'bottom'; wide?: boolean };
// Side panel that slides from the inline start (right in RTL) by default, or up from the bottom on phones.
export function SheetFrame({ open, onOpenChange, title, description, children, footer, side = 'start', wide = false, className = '' }: SheetFrameProps) {
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent dir="rtl" side={side} className={`kit-sheet kit-sheet--${side} ${wide ? 'kit-sheet--wide' : ''} ${className}`}>
      <SheetHeader className="kit-sheet-head"><SheetTitle className="display kit-sheet-title">{title}</SheetTitle>{description ? <SheetDescription className="kit-sheet-desc">{description}</SheetDescription> : <SheetDescription className="sr-only">{typeof title === 'string' ? title : 'لوحة جانبية'}</SheetDescription>}</SheetHeader>
      <div className="kit-sheet-body scroll-thin">{children}</div>
      {footer && <SheetFooter className="kit-sheet-foot">{footer}</SheetFooter>}
    </SheetContent>
  </Sheet>;
}

/* -------------------------------------------------------------------- Toast */
// Presentational toast (the stream toasts in notification-bell can adopt `.toast`); `tone` colours the edge.
export function Toast({ tone = 'info', title, body, action, onClose, className = '' }: { tone?: 'info' | 'ok' | 'warn' | 'danger'; title: ReactNode; body?: ReactNode; action?: { label: string; onClick: () => void }; onClose?: () => void; className?: string }) {
  return <div className={`toast toast-${tone} ${className}`} role="status">
    <div className="min-w-0 flex-1">
      <strong className="block truncate text-sm">{title}</strong>
      {body && <p className="m-0 mt-1 text-xs leading-6 text-quiet">{body}</p>}
      {action && <button type="button" className="mt-1 min-h-8 text-xs font-semibold text-teal-bright" onClick={action.onClick}>{action.label}</button>}
    </div>
    {onClose && <button type="button" className="kit-toast-close" onClick={onClose} aria-label="إغلاق التنبيه"><X size={16} aria-hidden="true" /></button>}
  </div>;
}

/* --------------------------------------------------------- PageTransition */
// Fades/slides a page in when `routeKey` changes (200 ms; reduced motion = instant).
export function PageTransition({ routeKey, children, className = '' }: { routeKey: string; children: ReactNode; className?: string }) {
  return <div key={routeKey} className={`page-enter ${className}`}>{children}</div>;
}

/* ---------------------------------------------------------- Command palette */
export const commandPaletteEvent = 'hbs:command-palette';
// Opens the command palette PortalLayout mounts (the topbar search affordance calls this).
export function openCommandPalette() { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(commandPaletteEvent)); }
// Runs `onOpen` on ⌘K / Ctrl+K and on `openCommandPalette()`; the palette itself (components/command-palette.tsx) mounts once in PortalLayout.
export function useCommandPalette(onOpen: () => void) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); onOpen(); } };
    const onEvent = () => onOpen();
    window.addEventListener('keydown', onKey);
    window.addEventListener(commandPaletteEvent, onEvent);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(commandPaletteEvent, onEvent); };
  }, [onOpen]);
}
