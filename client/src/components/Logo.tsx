/**
 * Shelved: spines standing on a shelf, with one leaning — the thing you
 * started and put down. Reads at 20px and at 200px.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="Shelved"
    >
      {/* upright spines */}
      <rect x="5" y="9" width="4.2" height="15" rx="1.2" fill="currentColor" opacity="0.55" />
      <rect x="10.6" y="12.5" width="4.2" height="11.5" rx="1.2" fill="currentColor" opacity="0.4" />
      <rect x="16.2" y="6.5" width="4.2" height="17.5" rx="1.2" fill="var(--accent, #f472b6)" />
      {/* the one that has been leaned against the rest */}
      <rect
        x="22.2"
        y="10"
        width="4.2"
        height="14"
        rx="1.2"
        fill="currentColor"
        opacity="0.55"
        transform="rotate(13 24.3 24)"
      />
      {/* the shelf */}
      <rect x="2.5" y="24.5" width="27" height="3.2" rx="1.6" fill="currentColor" />
    </svg>
  )
}
