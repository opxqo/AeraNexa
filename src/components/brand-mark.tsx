type BrandMarkProps = { size?: number; className?: string };

/** AeraNexa 品牌图形：三个节点连成的 "A"，横杠是一道信号弧。跟随 currentColor 着色。 */
export function BrandMark({ size = 22, className }: BrandMarkProps) {
  return (
    <svg aria-hidden="true" className={className} height={size} viewBox="0 0 64 64" width={size}>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5">
        <path d="M8.5 53.5 32 11 55.5 53.5" />
        <path d="M8.5 53.5C18 40 25 38.3 32 38.3S46 40 55.5 53.5" />
      </g>
      <g fill="currentColor">
        <circle cx="32" cy="11" r="6" />
        <circle cx="8.5" cy="53.5" r="6" />
        <circle cx="55.5" cy="53.5" r="6" />
      </g>
    </svg>
  );
}
