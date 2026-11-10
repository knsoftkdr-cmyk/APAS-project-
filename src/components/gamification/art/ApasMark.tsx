/**
 * The APAS mark: a four-point "guide star" with an A cut into it. Original artwork owned by APAS.
 * Used on the mascot, in hero badges, as floating sparkles and as the class badge.
 */
export const APAS_STAR_PATH =
  "M24 2C26 14 34 22 46 24C34 26 26 34 24 46C22 34 14 26 2 24C14 22 22 14 24 2Z";
export const APAS_A_PATH = "M17 33L24 15L31 33M19.8 27H28.2";

export function ApasMark({
  size = 40,
  fill = "#FFB830",
  ink = "#24135F",
  withA = true,
  className,
}: {
  size?: number;
  fill?: string;
  ink?: string;
  withA?: boolean;
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path d={APAS_STAR_PATH} fill={fill} stroke={ink} strokeWidth="1.6" strokeLinejoin="round" />
      {withA && (
        <path d={APAS_A_PATH} fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
