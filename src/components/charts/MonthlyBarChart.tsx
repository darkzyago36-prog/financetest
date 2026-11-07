import React from 'react';
import { formatBRL } from '../../data/initialData';
import { computeSmartAxisCeiling } from '../../services/analyticsService';
import { MonthlySummaryPoint } from '../../types/finance';

interface MonthlyBarChartProps {
  points: MonthlySummaryPoint[];
  onSelectMonth?: (monthKey: string) => void;
}

export const MonthlyBarChart: React.FC<MonthlyBarChartProps> = ({ points, onSelectMonth }) => {
  const rawMax = Math.max(0, ...points.map((p) => Math.max(p.income, p.expenses)));
  const ceiling = computeSmartAxisCeiling(rawMax);

  const ticks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => {
    const val = ceiling * ratio;
    if (val === 0) return 'R$ 0';
    return val >= 1000
      ? `R$ ${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1).replace('.', ',')}k`
      : `R$ ${Math.round(val)}`;
  });

  return (
    <div className="w-full h-64 relative pt-space-xs">
      <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-50">
        {ticks.map((tick) => (
          <div
            key={tick}
            className="w-full h-px bg-surface-container flex items-center justify-end pr-1"
          >
            <span className="text-[10px] text-secondary tabular-nums">{tick}</span>
          </div>
        ))}
      </div>

      <div className="relative h-full flex items-end justify-between px-2 sm:px-space-md z-10 gap-1">
        {points.map((bar) => {
          const incPct = ceiling > 0 ? Math.max(bar.income > 0 ? 4 : 0, (bar.income / ceiling) * 100) : 0;
          const expPct = ceiling > 0 ? Math.max(bar.expenses > 0 ? 4 : 0, (bar.expenses / ceiling) * 100) : 0;

          return (
            <button
              key={bar.monthKey}
              type="button"
              onClick={() => onSelectMonth?.(bar.monthKey)}
              className="flex flex-col items-center gap-2 flex-1 group cursor-pointer bg-transparent border-0 p-0 focus:outline-none"
            >
              <div className="flex items-end gap-1 sm:gap-1.5 h-48">
                <div
                  className={`w-3 sm:w-5 rounded-t-md transition-transform group-hover:scale-y-105 origin-bottom relative ${
                    bar.isCurrent ? 'bg-primary shadow-xs' : 'bg-primary/90 hover:bg-primary'
                  }`}
                  style={{ height: `${incPct}%` }}
                >
                  <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-inverse-surface text-inverse-on-surface text-[10px] font-semibold px-2 py-0.5 rounded shadow pointer-events-none whitespace-nowrap transition-opacity z-20 tabular-nums">
                    Receitas: {formatBRL(bar.income)}
                  </div>
                </div>

                <div
                  className={`w-3 sm:w-5 rounded-t-md transition-transform group-hover:scale-y-105 origin-bottom relative ${
                    bar.isCurrent
                      ? 'bg-error/75 hover:bg-error shadow-xs'
                      : 'bg-secondary-fixed-dim hover:bg-secondary'
                  }`}
                  style={{ height: `${expPct}%` }}
                >
                  <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-inverse-surface text-inverse-on-surface text-[10px] font-semibold px-2 py-0.5 rounded shadow pointer-events-none whitespace-nowrap transition-opacity z-20 tabular-nums">
                    Despesas: {formatBRL(bar.expenses)}
                  </div>
                </div>
              </div>

              <span
                className={`text-[11px] sm:text-xs whitespace-nowrap truncate max-w-[72px] sm:max-w-none ${
                  bar.isCurrent
                    ? 'font-bold text-primary'
                    : 'text-secondary group-hover:text-on-surface'
                }`}
              >
                {bar.shortLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
