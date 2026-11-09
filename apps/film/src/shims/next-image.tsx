import { Img, staticFile } from "remotion";

type Props = { src: string; alt: string; width?: number; height?: number; className?: string; style?: React.CSSProperties; unoptimized?: boolean };

/** next/image for the film: Remotion's <Img> waits for each logo to load before the frame is captured. */
export default function Image({ src, alt, width, height, className, style }: Props) {
  return <Img src={src.startsWith("/") ? staticFile(src.slice(1)) : src} alt={alt} width={width} height={height} className={className} style={style} />;
}
