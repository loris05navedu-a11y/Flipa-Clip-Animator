/** Original Frameloom mark: three offset frames forming a loop. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="fl-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b7cf6" />
          <stop offset="1" stopColor="#ff7a59" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="16" fill="url(#fl-g)" />
      <rect x="15" y="17" width="22" height="22" rx="5" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="3" />
      <rect x="21" y="21" width="22" height="22" rx="5" fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="3" />
      <rect x="27" y="25" width="22" height="22" rx="5" fill="#fff" />
      <path d="M34 31 L43 36 L34 41 Z" fill="#6c5ce7" />
    </svg>
  );
}
