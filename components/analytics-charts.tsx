'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type DataRow = Record<string, string | number | null | undefined>;

const colors = ['#f4f7ff', '#91a7ff', '#6ee7b7', '#93c5fd', '#c4b5fd'];

export function ActivityAreaChart({
  data,
  admin = false,
}: {
  data: DataRow[];
  admin?: boolean;
}) {
  const rows = data.map((item) => ({
    ...item,
    label: shortDate(String(item.day || '')),
    calls: Number(item.calls || 0),
    leads: Number(item.leads || 0),
    conversions: Number(item.conversions || item.completed || 0),
  }));
  return (
    <div
      className="h-[260px] min-w-0 w-full"
      aria-label="Fourteen day activity chart"
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={1}
        initialDimension={{ width: 800, height: 260 }}
      >
        <AreaChart
          data={rows}
          margin={{ top: 10, right: 6, left: -24, bottom: 0 }}
        >
          <defs>
            <linearGradient id={`calls-${admin}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#91a7ff" stopOpacity={0.48} />
              <stop offset="100%" stopColor="#91a7ff" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`leads-${admin}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f4f7ff" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#f4f7ff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="rgba(255,255,255,.055)"
            strokeDasharray="2 5"
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'rgba(255,255,255,.34)', fontSize: 9 }}
            interval={2}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'rgba(255,255,255,.28)', fontSize: 9 }}
          />
          <Tooltip
            content={<GlassTooltip />}
            cursor={{ stroke: 'rgba(255,255,255,.12)' }}
          />
          <Area
            type="monotone"
            dataKey="leads"
            name="Leads"
            stroke="#f4f7ff"
            strokeWidth={1.5}
            fill={`url(#leads-${admin})`}
          />
          <Area
            type="monotone"
            dataKey="calls"
            name="Calls"
            stroke="#91a7ff"
            strokeWidth={2.25}
            fill={`url(#calls-${admin})`}
          />
          <Area
            type="monotone"
            dataKey="conversions"
            name={admin ? 'Completed' : 'Conversions'}
            stroke="#6ee7b7"
            strokeWidth={1.75}
            fill="transparent"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DistributionChart({
  data,
  nameKey = 'name',
  valueKey = 'value',
}: {
  data: DataRow[];
  nameKey?: string;
  valueKey?: string;
}) {
  const rows = data
    .map((item, index) => ({
      name: String(item[nameKey] || 'unknown').replaceAll('_', ' '),
      value: Number(item[valueKey] || 0),
      fill: colors[index % colors.length],
    }))
    .filter((item) => item.value > 0);
  if (!rows.length) return <ChartEmpty />;
  return (
    <div className="grid min-h-[240px] min-w-0 grid-cols-[0.86fr_1.14fr] items-center gap-2">
      <div className="h-[210px] min-w-0">
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          minHeight={1}
          initialDimension={{ width: 320, height: 210 }}
        >
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              innerRadius="63%"
              outerRadius="86%"
              paddingAngle={4}
              stroke="transparent"
            />
            <Tooltip content={<GlassTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-3">
        {rows.slice(0, 5).map((item, index) => (
          <div key={item.name} className="flex items-center gap-2 text-[11px]">
            <span
              className="size-1.5 rounded-full"
              style={{ background: colors[index % colors.length] }}
            />
            <span className="min-w-0 flex-1 truncate capitalize text-ink-muted">
              {item.name}
            </span>
            <span className="font-mono text-ink">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QueueBars({ data }: { data: DataRow[] }) {
  const rows = data.map((item) => ({
    name: String(item.status || item.name || 'unknown').replaceAll('_', ' '),
    value: Number(item.value || 0),
  }));
  if (!rows.length) return <ChartEmpty />;
  return (
    <div className="h-[230px] min-w-0">
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={1}
        initialDimension={{ width: 480, height: 230 }}
      >
        <BarChart
          data={rows}
          margin={{ top: 12, right: 4, left: -28, bottom: 0 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="rgba(255,255,255,.055)"
            strokeDasharray="2 5"
          />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'rgba(255,255,255,.34)', fontSize: 8 }}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'rgba(255,255,255,.28)', fontSize: 9 }}
          />
          <Tooltip
            content={<GlassTooltip />}
            cursor={{ fill: 'rgba(255,255,255,.025)' }}
          />
          <Bar
            dataKey="value"
            name="Jobs"
            radius={[5, 5, 1, 1]}
            fill="#91a7ff"
            maxBarSize={38}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function GlassTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: unknown; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-32 rounded-xl border border-hairline bg-surface p-3 shadow-2xl backdrop-blur-xl">
      <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      {payload.map((item) => (
        <div
          key={item.name}
          className="flex items-center justify-between gap-5 text-[11px]"
        >
          <span style={{ color: item.color }} className="capitalize">
            {item.name}
          </span>
          <span className="font-mono text-ink">
            {primitiveText(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="grid min-h-[220px] place-items-center text-xs text-ink-muted">
      Waiting for production activity
    </div>
  );
}
function shortDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
function primitiveText(value: unknown) {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
    ? String(value)
    : '0';
}
