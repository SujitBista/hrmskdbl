import Image from "next/image";

type Props = {
  variant?: "header" | "hero";
  className?: string;
};

export function SaptakoshiLogo({
  variant = "hero",
  className = "",
}: Props) {
  const size =
    variant === "header"
      ? "h-9 w-auto max-w-[min(100%,220px)] object-contain object-left sm:h-10"
      : "mx-auto h-14 w-auto max-w-full object-contain sm:h-[4.5rem]";

  return (
    <Image
      src="/saptakoshi-logo.png"
      alt="Saptakoshi Development Bank Limited"
      width={800}
      height={179}
      sizes="(max-width: 640px) 100vw, 320px"
      className={`${size} ${className}`.trim()}
      priority={variant === "hero"}
    />
  );
}
