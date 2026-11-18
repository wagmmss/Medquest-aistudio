"use client";

import { useMemo, useState } from "react";

export interface TimelineChartRow {
  day: string;
  dateShort: string;
  attempts: number;
  accPct: number;
}

export function TimelineEvolutionChart({ data }: { data: TimelineChartRow[] }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const width = 760;
  const height = 280;
  const padTop = 18;
  const padRight = 18;
  const padBottom = 34;
  const padLeft = 36;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxAttempts = useMemo(() => {
    let max = 10;
    for (const d of data) {
      if (d.attempts > max) max = d.attempts;
    }
    return Math.ceil(max / 5) * 5;
  }, [data]);

  const points = useMemo(() => {
    const n = data.length;
    return data.map((row, idx) => {
      const slotW = plotW / Math.max(1, n);
      const x = padLeft + slotW * idx + slotW / 2;
      const barW = Math.min(24, Math.max(4, slotW * 0.56));
      const barH = Math.max(0, (row.attempts / maxAttempts) * plotH);
      const barY = padTop + plotH - barH;
      const accClamped = Math.max(0, Math.min(100, row.accPct || 0));
      const lineY = padTop + plotH - (accClamped / 100) * plotH;
      return {
        ...row,
        x,
        slotLeft: padLeft + slotW * idx,
        slotW,
        barW,
        barH,
        barY,
        lineY,
      };
    });
  }, [data, maxAttempts, plotW, plotH]);

  const { linePath, areaPath } = useMemo(() => {
    if (points.length === 0) return { linePath: "", areaPath: "" };
    if (points.length === 1) {
      const p = points[0];
      const base = padTop + plotH;
      return {
        linePath: `M ${p.x} ${p.lineY}`,
        areaPath: `M ${p.x - 10} ${base} L ${p.x} ${p.lineY} L ${p.x + 10} ${base} Z`,
      };
    }
    let d = `M ${points[0].x.toFixed(1)} ${points[0].lineY.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = ((p0.x + p1.x) / 2).toFixed(1);
      d += ` C ${midX} ${p0.lineY.toFixed(1)}, ${midX} ${p1.lineY.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.lineY.toFixed(1)}`;
    }
    const base = (padTop + plotH).toFixed(1);
    const firstX = points[0].x.toFixed(1);
    const lastX = points[points.length - 1].x.toFixed(1);
    return {
      linePath: d,
      areaPath: `${d} L ${lastX} ${base} L ${firstX} ${base} Z`,
    };
  }, [points, plotH]);

  const yTicks = useMemo(
    () =>
      [0, 0.25, 0.5, 0.75, 1].map((t) => ({
        val: Math.round(maxAttempts * t),
        y: padTop + plotH * (1 - t),
      })),
    [maxAttempts, plotH]
  );

  const labelStep = Math.max(1, Math.ceil(points.length / 8));
  const activePoint = activeIdx !== null ? points[activeIdx] : null;

  return (
    <div
      className="relative w-full h-full select-none"
      onMouseLeave={() => setActiveIdx(null)}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full overflow-visible"
        role="img"
        aria-label="Gráfico de evolução de volume e acurácia diária"
      >
        <defs>
          <linearGradient id="colorAcc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--success)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="barAttempts" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.12} />
          </linearGradient>
        </defs>

        {yTicks.map((tick, idx) => (
          <g key={idx}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--border)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
            <text
              x={padLeft - 8}
              y={tick.y + 4}
              textAnchor="end"
              fill="var(--muted-foreground)"
              fontSize={11}
            >
              {tick.val}
            </text>
          </g>
        ))}

        {points.map((pt, idx) => (
          <g key={pt.day}>
            {activeIdx === idx && (
              <rect
                x={pt.slotLeft}
                y={padTop}
                width={pt.slotW}
                height={plotH}
                fill="var(--muted)"
                opacity={0.15}
                rx={4}
              />
            )}
            {pt.barH > 0 && (
              <rect
                x={pt.x - pt.barW / 2}
                y={pt.barY}
                width={pt.barW}
                height={pt.barH}
                fill="url(#barAttempts)"
                rx={3}
              />
            )}
            {(idx % labelStep === 0 || idx === points.length - 1) && (
              <text
                x={pt.x}
                y={height - 10}
                textAnchor="middle"
                fill="var(--muted-foreground)"
                fontSize={11}
                fontWeight={500}
              >
                {pt.dateShort}
              </text>
            )}
          </g>
        ))}

        {areaPath && <path d={areaPath} fill="url(#colorAcc)" stroke="none" />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="var(--success)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {points.map((pt, idx) => {
          const isActive = activeIdx === idx;
          return (
            <g key={`dot-${pt.day}`}>
              <circle
                cx={pt.x}
                cy={pt.lineY}
                r={isActive ? 6 : 4}
                fill={isActive ? "var(--success)" : "var(--background)"}
                stroke={isActive ? "var(--background)" : "var(--success)"}
                strokeWidth={2.5}
              />
              <rect
                x={pt.slotLeft}
                y={padTop}
                width={pt.slotW}
                height={plotH}
                fill="transparent"
                className="cursor-pointer outline-none"
                tabIndex={0}
                role="button"
                aria-label={`${pt.day}: ${pt.attempts} questões, ${pt.accPct}% de acurácia`}
                onMouseEnter={() => setActiveIdx(idx)}
                onFocus={() => setActiveIdx(idx)}
                onBlur={() => setActiveIdx((prev) => (prev === idx ? null : prev))}
                onClick={() => setActiveIdx((prev) => (prev === idx ? null : idx))}
              />
            </g>
          );
        })}
      </svg>

      {activePoint && (
        <div
          className="pointer-events-none absolute top-2 bg-popover border border-line-subtle shadow-md rounded-md p-3 text-xs z-50 min-w-[180px]"
          style={{
            left: `${Math.min(72, Math.max(4, (activePoint.x / width) * 100))}%`,
          }}
        >
          <p className="font-mono-lab font-bold text-popover-foreground mb-2 border-b border-line-subtle pb-1.5">
            {activePoint.day}
          </p>
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-muted-foreground">Volume</span>
            <span className="font-mono-lab tabular-nums font-semibold text-foreground">
              {activePoint.attempts} q.
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Acurácia</span>
            <span className="font-mono-lab tabular-nums font-bold text-success">
              {activePoint.accPct}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
