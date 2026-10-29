import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base} {...props} fill="currentColor" stroke="none">
      <path d="M8.4 5.3c0-.9 1-1.5 1.8-1L18.9 10c.8.4.8 1.6 0 2l-8.7 5.7c-.8.5-1.8-.1-1.8-1z" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...base} {...props} fill="currentColor" stroke="none">
      <rect x="7" y="5" width="3.4" height="14" rx="1.2" />
      <rect x="13.6" y="5" width="3.4" height="14" rx="1.2" />
    </svg>
  );
}

export function PrevIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M18 6 9.5 12l8.5 6z" fill="currentColor" stroke="none" />
      <path d="M6 5.5v13" />
    </svg>
  );
}

export function NextIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l8.5 6L6 18z" fill="currentColor" stroke="none" />
      <path d="M18 5.5v13" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="6.2" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function ScanIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function MusicIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function VolumeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 10v4h3.5L12 18V6L7.5 10z" fill="currentColor" stroke="none" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
      <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 10.4 12 4l8 6.4V19a1.4 1.4 0 0 1-1.4 1.4h-3.9v-5.7h-5.4v5.7H5.4A1.4 1.4 0 0 1 4 19z" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6V12l3 1.9" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.2 13.4c.1-.5.1-.9 0-1.4l1.5-1.2-1.7-3-1.9.7c-.4-.3-.8-.5-1.2-.7L15.5 5h-3.4l-.4 2.1c-.4.1-.8.4-1.2.6l-1.9-.7-1.7 3 1.5 1.2c-.1.5-.1.9 0 1.4l-1.5 1.2 1.7 3 1.9-.7c.4.3.8.5 1.2.7l.4 2.1h3.4l.4-2.1c.4-.1.8-.4 1.2-.6l1.9.7 1.7-3z" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2M12 19.2v2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M2.8 12h2M19.2 12h2M5.4 18.6l1.4-1.4M17.2 6.8l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2z" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

export function Rewind10Icon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.6 10.2A7.8 7.8 0 1 1 5 15.6" />
      <path d="M4.2 5.6v5h5" />
      <text x="12.4" y="15.4" textAnchor="middle" fontSize="7.6" fontWeight="700" fill="currentColor" stroke="none">
        10
      </text>
    </svg>
  );
}

export function Forward10Icon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M19.4 10.2A7.8 7.8 0 1 0 19 15.6" />
      <path d="M19.8 5.6v5h-5" />
      <text x="11.6" y="15.4" textAnchor="middle" fontSize="7.6" fontWeight="700" fill="currentColor" stroke="none">
        10
      </text>
    </svg>
  );
}

export function ExpandIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function DiscIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.3" />
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  );
}

export function HeartIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base} {...props} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 20.2S4.2 15.5 4.2 9.9a4.4 4.4 0 0 1 7.8-2.8 4.4 4.4 0 0 1 7.8 2.8c0 5.6-7.8 10.3-7.8 10.3z" />
    </svg>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <svg {...base} {...props} fill="currentColor" stroke="none">
      <path d="m12 3.6 2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.7-5 2.7 1-5.6-4.1-4 5.6-.8z" />
    </svg>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2.1" />
      <circle cx="8" cy="17" r="2.1" />
    </svg>
  );
}

export function HashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9.5 4 7.8 20M16.2 4l-1.7 16M4.8 9h15M4 15h15" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 12a8 8 0 1 1-2.2-5.5" />
      <path d="M20 4.5V10h-5.5" />
    </svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.8 12h16.4M12 3.8c2.3 2.3 3.4 5.2 3.4 8.2s-1.1 5.9-3.4 8.2c-2.3-2.3-3.4-5.2-3.4-8.2S9.7 6.1 12 3.8z" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M4.8 19.5c.8-3.3 3.7-5.4 7.2-5.4s6.4 2.1 7.2 5.4" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v10M8 10.5l4 4 4-4M5 19.5h14" />
    </svg>
  );
}

export function PipIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
      <rect x="12" y="11" width="6.5" height="5.5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function EqualizerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 4v16M12 4v16M18 4v16" />
      <circle cx="6" cy="9" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18" cy="7.5" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

export function ShuffleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h2.5c4 0 5.5 10 9.5 10H20M4 17h2.5c1.5 0 2.7-1.4 3.8-3.2M14.2 9.2C15.1 7.9 16.1 7 17.5 7H20" />
      <path d="m17.5 4.5 2.5 2.5-2.5 2.5M17.5 14.5l2.5 2.5-2.5 2.5" />
    </svg>
  );
}

export function TimerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="13.2" r="7.4" />
      <path d="M12 9.5v3.9l2.6 1.6M9.5 3.5h5M12 3.5v2.1" />
    </svg>
  );
}

export function MonitorIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5" width="17" height="11.5" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 3.5h7l4 4v13h-11z" />
      <path d="M13.5 3.5v4h4M9.5 13h5M9.5 16.5h5" />
    </svg>
  );
}

export function VideoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.4" />
      <path d="m10.5 9.4 4.4 2.6-4.4 2.6z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.4" />
      <circle cx="9" cy="9.6" r="1.7" />
      <path d="m5.4 17.8 4.6-4.4 3.3 3.1 2.5-2.2 3.2 3.1" />
    </svg>
  );
}

export function SubtitleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.4" />
      <path d="M7.5 11h4.2M7.5 14.4h7M14.6 11h2.2M16.4 14.4h.4" />
    </svg>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8.5 7h11M8.5 12h11M8.5 17h11" />
      <circle cx="4.8" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.8" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.8" cy="17" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </svg>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10zM13.5 8.5l2 2" />
    </svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 5.5v5.2L12 18.2a1.8 1.8 0 0 0 2.6 0l4.1-4.1a1.8 1.8 0 0 0 0-2.6L11.2 4H6a1.5 1.5 0 0 0-1.5 1.5z" />
      <circle cx="8.4" cy="8.4" r="1.2" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5.5" y="10" width="13" height="9" rx="2.2" />
      <path d="M8.5 10V7.8a3.5 3.5 0 0 1 7 0V10" />
      <circle cx="12" cy="14.4" r="1.1" />
    </svg>
  );
}

export function LanIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.8 12h16.4M12 3.8c2.4 2.3 3.6 5.1 3.6 8.2s-1.2 5.9-3.6 8.2c-2.4-2.3-3.6-5.1-3.6-8.2S9.6 6.1 12 3.8z" />
    </svg>
  );
}

export function LogIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4.5" width="16" height="15" rx="2.4" />
      <path d="M7.8 9h8.4M7.8 12.5h5.6M7.8 16h8.4" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="8.5" y="8.5" width="10.5" height="10.5" rx="2" />
      <path d="M15.5 5.5H6.8a1.8 1.8 0 0 0-1.8 1.8v8.7" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.8 7h14.4M9.2 7V5.4A1.4 1.4 0 0 1 10.6 4h2.8a1.4 1.4 0 0 1 1.4 1.4V7" />
      <path d="M6.6 7l.8 11a1.8 1.8 0 0 0 1.8 1.7h5.6a1.8 1.8 0 0 0 1.8-1.7l.8-11M10.2 10.6v5.6M13.8 10.6v5.6" />
    </svg>
  );
}

