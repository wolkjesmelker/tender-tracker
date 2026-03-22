'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { AanbestedingStatus, STATUS_LABELS } from '@/types';

interface StatusChartProps {
  data: Partial<Record<AanbestedingStatus, number>>;
}

const CHART_COLORS: Record<AanbestedingStatus, string> = {
  gevonden: '#3b82f6',
  gekwalificeerd: '#eab308',
  in_aanbieding: '#22c55e',
  afgewezen: '#ef4444',
};

export function StatusChart({ data }: StatusChartProps) {
  const chartData = (Object.keys(data) as AanbestedingStatus[])
    .filter((key) => (data[key] ?? 0) > 0)
    .map((key) => ({
      name: STATUS_LABELS[key],
      value: data[key] ?? 0,
      color: CHART_COLORS[key],
    }));

  if (chartData.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Geen data beschikbaar
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={80}
          paddingAngle={3}
          dataKey="value"
        >
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, name) => [value, name]}
          contentStyle={{
            borderRadius: '8px',
            border: '1px solid hsl(var(--border))',
            fontSize: '12px',
          }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value) => (
            <span className="text-xs text-muted-foreground">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
