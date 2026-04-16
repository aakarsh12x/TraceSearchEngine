"use client";
import { cn } from "@/lib/utils";
import React, { useId } from "react";

interface NoiseBackgroundProps {
  children: React.ReactNode;
  containerClassName?: string;
  className?: string;
  gradientColors?: string[];
  noiseOpacity?: number;
  noiseFrequency?: number;
}

export function NoiseBackground({
  children,
  containerClassName,
  className,
  gradientColors = ["rgb(255, 100, 150)", "rgb(100, 150, 255)", "rgb(255, 200, 100)"],
  noiseOpacity = 0.18,
  noiseFrequency = 0.65,
}: NoiseBackgroundProps) {
  const id = useId();
  const filterId = `noise-filter-${id.replace(/:/g, "")}`;

  const gradient =
    gradientColors.length >= 2
      ? `linear-gradient(135deg, ${gradientColors.join(", ")})`
      : gradientColors[0] ?? "transparent";

  return (
    <div className={cn("relative", containerClassName)}>
      {/* Gradient layer */}
      <div
        className="absolute inset-0 rounded-[inherit]"
        style={{ background: gradient }}
      />

      {/* Noise overlay */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full rounded-[inherit]"
        style={{ opacity: noiseOpacity }}
        aria-hidden="true"
      >
        <filter id={filterId}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency={noiseFrequency}
            numOctaves={4}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${filterId})`} />
      </svg>

      {/* Content */}
      <div className={cn("relative z-10", className)}>{children}</div>
    </div>
  );
}
