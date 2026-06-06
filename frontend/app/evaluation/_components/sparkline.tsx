"use client";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  YAxis,
  ReferenceLine,
} from "recharts";

export function slopeBadge(values: number[]): { label: string; color: string } {
  if (values.length < 2) return { label: "—", color: "text-muted-foreground" };
  const slope = (values[values.length - 1]! - values[0]!) / (values.length - 1);
  if (slope > 0.05) return { label: "improving ↑", color: "text-green-600" };
  if (slope < -0.05) return { label: "degrading ↓", color: "text-red-500" };
  return { label: "stable →", color: "text-muted-foreground" };
}

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
}

export function Sparkline({ data, color = "#6366f1", height = 40 }: SparklineProps) {
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <YAxis domain={[0, 1]} hide />
        <ReferenceLine y={0.5} stroke="#e5e7eb" strokeDasharray="3 2" />
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          dot={{ r: 3, fill: color }}
          isAnimationActive={false}
        />
        <Tooltip
          formatter={(value) => [
            typeof value === "number" ? value.toFixed(2) : String(value ?? ""),
            "",
          ]}
          labelFormatter={() => ""}
          contentStyle={{ fontSize: 11 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
