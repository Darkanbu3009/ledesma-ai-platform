export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Ledesma AI Labs"
    >
      <rect x="2" y="2" width="44" height="44" rx="11" fill="#1A1A1F" stroke="#2A2A30" />
      <path d="M17 12 V32 H31" stroke="#F2EFE9" strokeWidth="3.5" strokeLinecap="square" />
      <circle cx="31" cy="32" r="3.6" fill="#E5562A" />
    </svg>
  );
}
