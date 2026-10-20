import type { ReactNode } from 'react';
import {
  Accessibility, ArrowDown, ArrowDownRight, ArrowUp, ArrowUpDown, ArrowUpRight, Bell, BookOpen, Building, Building2, Calendar,
  CalendarRange, ChartColumn, ChartLine, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Circle,
  CircleAlert, CircleCheck, CircleX, Clock, Compass, Copy, Download, Ellipsis, ExternalLink, Eye, Funnel, Globe, GraduationCap,
  HeartHandshake, House, Image as ImageIcon, Inbox, Info, Layers, ListChecks, LoaderCircle, LogOut, Map as MapIcon, MapPin, Menu, Minus, Moon, Pencil,
  Play, Plus, Presentation, RefreshCw, School, ScrollText, Search, Send, Settings2, Shuffle, Star, Sun, Ticket, Trash2,
  TriangleAlert, Upload, User, Users, X, type LucideIcon,
} from 'lucide-react';
import { cn } from './cn';

/**
 * Static icon map (kebab-case lucide names) so the bundle carries only what we use.
 * Covers every icon in src/server/auth/menu.ts plus common controls.
 */
export const ICONS = {
  accessibility: Accessibility,
  'arrow-down': ArrowDown,
  'arrow-down-right': ArrowDownRight,
  'arrow-up': ArrowUp,
  'arrow-up-down': ArrowUpDown,
  'arrow-up-right': ArrowUpRight,
  bell: Bell,
  'book-open': BookOpen,
  building: Building,
  'building-2': Building2,
  calendar: Calendar,
  'calendar-range': CalendarRange,
  'chart-column': ChartColumn,
  'chart-line': ChartLine,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'chevrons-up-down': ChevronsUpDown,
  circle: Circle,
  'circle-alert': CircleAlert,
  'circle-check': CircleCheck,
  'circle-x': CircleX,
  clock: Clock,
  compass: Compass,
  copy: Copy,
  download: Download,
  ellipsis: Ellipsis,
  'external-link': ExternalLink,
  eye: Eye,
  filter: Funnel,
  globe: Globe,
  'graduation-cap': GraduationCap,
  'heart-handshake': HeartHandshake,
  house: House,
  image: ImageIcon,
  inbox: Inbox,
  info: Info,
  layers: Layers,
  'list-checks': ListChecks,
  'loader-circle': LoaderCircle,
  'log-out': LogOut,
  map: MapIcon,
  'map-pin': MapPin,
  menu: Menu,
  minus: Minus,
  moon: Moon,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  presentation: Presentation,
  'refresh-cw': RefreshCw,
  school: School,
  'scroll-text': ScrollText,
  search: Search,
  send: Send,
  'settings-2': Settings2,
  shuffle: Shuffle,
  star: Star,
  sun: Sun,
  ticket: Ticket,
  'trash-2': Trash2,
  'triangle-alert': TriangleAlert,
  upload: Upload,
  user: User,
  users: Users,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
/** An icon name from the map, or any React node (e.g. a custom svg). */
export type IconInput = IconName | ReactNode;

export function isIconName(name: unknown): name is IconName {
  return typeof name === 'string' && name in ICONS;
}

export interface IconProps {
  /** Kebab-case lucide name. Unknown names (e.g. from the API) fall back to a circle. */
  name: IconName | (string & {});
  /** 16 in controls, 18 in the nav. */
  size?: number;
  strokeWidth?: number;
  /** Accessible name; set only when the icon stands alone. */
  title?: string;
  className?: string;
}

export function Icon({ name, size = 16, strokeWidth = 1.6, title, className }: IconProps) {
  const Cmp = isIconName(name) ? ICONS[name] : Circle;
  return (
    <Cmp
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={cn('block flex-none', className)}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? 'img' : undefined}
      focusable="false"
    />
  );
}

/** Renders an IconInput: a name becomes <Icon>, a node is returned as is. */
export function renderIcon(icon: IconInput | undefined, size = 16): ReactNode {
  if (icon === undefined || icon === null || icon === false) return null;
  if (typeof icon === 'string') return <Icon name={icon} size={size} />;
  return icon;
}
