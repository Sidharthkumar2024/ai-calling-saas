type CallVaniLogoProps = {
  className?: string;
  label?: string;
};

export function CallVaniLogo({
  className = 'size-10',
  label,
}: CallVaniLogoProps) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-[28%] bg-[#061f3e] ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 64 64" className="size-[76%]" fill="none">
        <path
          d="M5 32h9m36 0h9M16 21v22m32-22v22M16 28c7-18 13-13 16 3s9 20 16 2"
          stroke="#78ff39"
          strokeWidth="5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
