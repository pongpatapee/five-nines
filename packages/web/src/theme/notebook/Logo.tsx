/**
 * The game's mark: a yellow sticky note with a hand-written 9, marked "×5" in red pen, over a green uptime line with
 * one blip it recovered from. Five nines, graded in the margin. `favicon.svg` is the same drawing as a standalone file.
 */
export function StickyGradeLogo({ size = 32 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false">
      <path d="M3,3 C22,2 42,2 61,3 L61,49 L49,61 C34,62 18,62 3,61 C2,42 2,22 3,3 Z" fill="var(--highlighter)" />
      <path d="M61,49 L51,50 L49,61 Z" fill="var(--ink)" fillOpacity={0.22} />
      <path
        d="M40,22 C39,12 33,7 26,7 C18,7 12,13 12,21 C12,29 18,34 26,34 C33,34 39,29 40,22 C41,31 40,38 37,43"
        fill="none"
        stroke="var(--ink)"
        strokeWidth={6.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M44,13 L50,19 M50,13 L44,19 M59,9.5 L53,9.5 L52.5,15.5 C55.5,14 59.5,15.5 59.5,19 C59.5,23 54.5,24 52,22"
        fill="none"
        stroke="var(--red-pen)"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      <path
        d="M8,51 L20,51 L23,46 L27,55 L30,51 L44,51"
        fill="none"
        stroke="var(--green-pen)"
        strokeWidth={3.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
