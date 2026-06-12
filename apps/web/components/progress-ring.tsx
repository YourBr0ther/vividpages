/**
 * Animated SVG progress ring. Determinate when `percent` is a number
 * (animated stroke-dashoffset, percent readout in the center); indeterminate
 * (spinning quarter arc) when null.
 */
export function ProgressRing({
  percent,
  size = 64,
}: {
  percent: number | null;
  size?: number;
}) {
  const strokeWidth = 3.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const indeterminate = percent === null;
  const clamped = Math.min(Math.max(percent ?? 25, 0), 100);

  return (
    <div
      role="progressbar"
      aria-label="Processing progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      className="relative"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={indeterminate ? 'animate-spin [animation-duration:1.4s]' : '-rotate-90'}
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(231, 229, 228, 0.16)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-ember-400)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      {!indeterminate ? (
        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium tabular-nums text-parchment">
          {Math.round(clamped)}%
        </span>
      ) : null}
    </div>
  );
}
