import Image from "next/image";

type TelegramIconProps = { size?: number; className?: string };

/** 用户提供的 Telegram 品牌图标。 */
export function TelegramIcon({ size = 16, className }: TelegramIconProps) {
  return <Image alt="" aria-hidden="true" className={className} height={size} src="/icons/telegram.svg" width={size} />;
}
