import React, { useState } from 'react';
import { formatBRL } from '../../data/initialData';
import { CategoryBreakdownItem } from '../../types/finance';

interface DonutChartProps {
  items: CategoryBreakdownItem[];
  totalAmount: number;
  centerLabel?: string;
  centerSublabel?: string;
  compactTotal?: boolean;
  onSelectCategory?: (item: CategoryBreakdownItem) => void;
}

export const DonutChart: React.FC<DonutChartProps> = ({
  items,
  totalAmount,
  centerLabel = 'Total',
  centerSublabel,
  compactTotal = false,
  onSelectCategory,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const radius = 38;
  const circumference = 2 * Math.PI * radius; // ~238.76
  const focused = items.find((i) => i.id === hoveredId);

  let cumulativeOffset = 0;
  const segments = items.map((item) => {
    const fraction = totalAmount > 0 ? item.amount / totalAmount : 0;
    const length = fraction * circumference;
    const dash = `${length.toFixed(2)} ${circumference.toFixed(2)}`;
    const offset = -cumulativeOffset;
    cumulativeOffset += length;
    return {
      ...item,
      dash,
      offset,
    };
  });

  const displayCenterValue = focused
    ? formatBRL(focused.amount)
    : compactTotal && totalAmount >= 10000
    ? `R$ ${(totalAmount / 1000).toFixed(1).replace('.', ',')}k`
    : formatBRL(totalAmount);

  return (
    <div className="relative flex items-center justify-center my-space-md">
      <svg className="w-48 h-48 -rotate-90 transform" viewBox="0 0 100 100">
        <circle
          className="text-surface-container"
          cx="50"
          cy="50"
          fill="transparent"
          r={radius}
          stroke="currentColor"
          strokeWidth="12"
        />
        {segments.map((seg) => (
          <circle
            key={seg.id}
            cx="50"
            cy="50"
            fill="transparent"
            r={radius}
            stroke={seg.color}
            strokeDasharray={seg.dash}
            strokeDashoffset={seg.offset}
            strokeLinecap={items.length === 1 ? 'butt' : 'round'}
            strokeWidth={hoveredId === seg.id ? '14' : '12'}
            onMouseEnter={() => setHoveredId(seg.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => onSelectCategory?.(seg)}
            className="transition-all cursor-pointer"
          />
        ))}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-4">
        <span className="text-[11px] text-secondary font-semibold uppercase tracking-wider truncate max-w-[120px]">
          {focused ? focused.name : centerLabel}
        </span>
        <span className="text-lg font-bold text-on-surface tabular-nums">{displayCenterValue}</span>
        <span className="text-[11px] text-secondary">
          {focused
            ? `${focused.pct}% do total`
            : centerSublabel || `${items.length} ${items.length === 1 ? 'categoria' : 'categorias'}`}
        </span>
      </div>
    </div>
  );
};
