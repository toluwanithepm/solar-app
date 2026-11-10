// Icons: Lucide outline icons (one consistent stroke style), under the names the screens already use.
import {
  ArrowLeft,
  Banknote,
  Bell,
  Calendar,
  Camera,
  ChartColumn,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  Clock,
  Inbox,
  ChevronLeft,
  ChevronRight,
  Circle,
  CloudOff,
  Download,
  Ellipsis,
  FileText,
  Flashlight,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageSquare,
  Minus,
  Navigation,
  Pencil,
  Phone,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  Users,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';

const icons = {
  add: Plus,
  remove: Minus,
  back: ArrowLeft,
  close: X,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  check: Check,
  checkCircle: CheckCircle2,
  circle: Circle,
  more: Ellipsis,
  calendar: Calendar,
  dashboard: LayoutDashboard,
  people: Users,
  description: FileText,
  receipt: Receipt,
  bolt: Zap,
  phone: Phone,
  message: MessageSquare,
  directions: Navigation,
  camera: Camera,
  flashlight: Flashlight,
  warning: TriangleAlert,
  search: Search,
  edit: Pencil,
  delete: Trash2,
  download: Download,
  upload: Upload,
  bell: Bell,
  settings: Settings,
  wrench: Wrench,
  shield: ShieldCheck,
  chart: ChartColumn,
  logout: LogOut,
  person: User,
  pin: MapPin,
  sync: RefreshCw,
  cloudOff: CloudOff,
  print: Printer,
  money: Banknote,
  history: History,
  circleDot: CircleDot,
  clock: Clock,
  alertCircle: CircleAlert,
  inbox: Inbox,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons | 'whatsapp';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  style?: CSSProperties;
  /** Filled glyphs (the bolt in the logo) */
  filled?: boolean;
};

export function Icon({ name, size = 20, color = 'currentColor', style, filled }: Props) {
  if (name === 'whatsapp') return <WhatsApp size={size} color={color} style={style} />;
  const Glyph = icons[name];
  return <Glyph size={size} color={color} strokeWidth={size >= 24 ? 2 : 1.75} fill={filled ? color : 'none'} aria-hidden="true" style={{ flexShrink: 0, ...style }} />;
}

/** Brand mark (not in Lucide). */
function WhatsApp({ size, color, style }: { size: number; color: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.04 21.5h-.01a9.45 9.45 0 01-4.82-1.32l-.35-.21-3.58.94.96-3.49-.23-.36a9.43 9.43 0 01-1.45-5.03c0-5.22 4.25-9.47 9.48-9.47 2.53 0 4.91.99 6.7 2.78a9.4 9.4 0 012.77 6.7c0 5.22-4.25 9.46-9.47 9.46zM20.1 3.9A11.33 11.33 0 0012.04.56C5.76.56.65 5.67.65 11.95c0 2.01.52 3.97 1.52 5.7L.55 23.56l6.04-1.58a11.37 11.37 0 005.44 1.39h.01c6.28 0 11.39-5.11 11.39-11.39 0-3.04-1.19-5.9-3.33-8.05z" />
    </svg>
  );
}
