// Brand: the pointy-top hexagon monogram echoes as an empty-state motif
// (a nod to containers/infrastructure), never as decorative chrome elsewhere.

function Hexagon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" width={40} height={40} aria-hidden className={className}>
      <polygon
        points="48,8 82.64,28 82.64,68 48,88 13.36,68 13.36,28"
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-tdim">
      <Hexagon className="text-edge" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
