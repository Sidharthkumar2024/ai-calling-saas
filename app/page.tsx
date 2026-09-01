'use client';

import { useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Bell,
  Bot,
  CalendarCheck2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  ContactRound,
  Headphones,
  LayoutDashboard,
  MessageCircleMore,
  PhoneCall,
  PhoneForwarded,
  Plus,
  Radio,
  Settings2,
  Sparkles,
  Target,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const navItems = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'AI agents', icon: Bot },
  { label: 'Campaigns', icon: Radio },
  { label: 'Calls', icon: PhoneCall },
  { label: 'Contacts', icon: ContactRound },
  { label: 'CRM', icon: Target },
  { label: 'Appointments', icon: CalendarCheck2 },
  { label: 'WhatsApp', icon: MessageCircleMore },
];

const managementItems = [
  { label: 'Team', icon: UsersRound },
  { label: 'Billing', icon: WalletCards },
  { label: 'Settings', icon: Settings2 },
];

const moduleData: Record<
  string,
  {
    eyebrow: string;
    title: string;
    description: string;
    action: string;
    stats: { label: string; value: string; note: string }[];
    columns: string[];
    rows: string[][];
  }
> = {
  'AI agents': {
    eyebrow: 'Agent Studio',
    title: 'AI voice agents',
    description: 'Configure personas, languages, goals and business rules.',
    action: 'Create agent',
    stats: [
      { label: 'Active agents', value: '3', note: 'of 5 on plan' },
      { label: 'Calls handled', value: '872', note: 'today' },
      { label: 'Average latency', value: '1.2s', note: 'P95 response' },
      { label: 'Average QA', value: '94%', note: '+2.4% this week' },
    ],
    columns: ['Agent', 'Purpose', 'Language', 'Live calls', 'QA'],
    rows: [
      ['Maya', 'Real-estate qualification', 'Hinglish', '7', '96%'],
      ['Arjun', 'Lead follow-ups', 'Hindi', '4', '93%'],
      ['Meera', 'Inbound reception', 'English', '1', '92%'],
    ],
  },
  Campaigns: {
    eyebrow: 'Outbound calling',
    title: 'Campaigns',
    description: 'Run compliant outreach with calling windows, retries and consent filters.',
    action: 'New campaign',
    stats: [
      { label: 'Live campaigns', value: '2', note: '12 concurrent calls' },
      { label: 'Attempts today', value: '1,284', note: '+12.5% vs yesterday' },
      { label: 'Connected', value: '68.4%', note: '872 conversations' },
      { label: 'Conversions', value: '96', note: 'appointments booked' },
    ],
    columns: ['Campaign', 'Agent', 'Status', 'Progress', 'Outcome'],
    rows: [
      ['Gurugram site visits', 'Maya · Hinglish', 'Live', '438 / 610', '41 visits'],
      ['Noida lead reactivation', 'Arjun · Hindi', 'Live', '192 / 400', '26 hot leads'],
      ['Weekend open house', 'Maya · English', 'Scheduled', 'Starts 5:30 PM', '850 contacts'],
    ],
  },
  Calls: {
    eyebrow: 'Conversation intelligence',
    title: 'Call activity',
    description: 'Review transcripts, recordings, outcomes and follow-up actions.',
    action: 'Export calls',
    stats: [
      { label: 'Calls today', value: '1,284', note: '872 connected' },
      { label: 'Average duration', value: '2m 21s', note: '-8s vs last week' },
      { label: 'Callbacks due', value: '34', note: 'next 24 hours' },
      { label: 'Human transfers', value: '18', note: '2.1% of connects' },
    ],
    columns: ['Contact', 'Outcome', 'Agent', 'Duration', 'Time'],
    rows: [
      ['Aarav Khanna', 'Site visit booked', 'Maya', '2m 48s', '2 min ago'],
      ['Priya Mehta', 'Callback scheduled', 'Arjun', '1m 16s', '5 min ago'],
      ['Rohan Sharma', 'Brochure sent', 'Maya', '3m 02s', '8 min ago'],
      ['Neha Kapoor', 'Not interested', 'Arjun', '0m 54s', '11 min ago'],
    ],
  },
  Contacts: {
    eyebrow: 'Audience',
    title: 'Contacts',
    description: 'Manage consent, segments, call history and suppression status.',
    action: 'Import contacts',
    stats: [
      { label: 'Total contacts', value: '24,680', note: '+1,240 this month' },
      { label: 'Callable', value: '21,904', note: '88.8% consented' },
      { label: 'Hot leads', value: '386', note: 'last 30 days' },
      { label: 'Suppressed', value: '412', note: 'DNC protected' },
    ],
    columns: ['Contact', 'Segment', 'Consent', 'Last outcome', 'Owner'],
    rows: [
      ['Aarav Khanna', 'NCR buyers', 'Verified', 'Visit booked', 'Riya'],
      ['Priya Mehta', 'Warm leads', 'Verified', 'Callback', 'Karan'],
      ['Rohan Sharma', 'Investors', 'Verified', 'Details sent', 'Riya'],
      ['Neha Kapoor', 'Past enquiries', 'Verified', 'Not interested', 'Karan'],
    ],
  },
  CRM: {
    eyebrow: 'Sales pipeline',
    title: 'Qualified opportunities',
    description: 'Track AI-qualified leads from first conversation to conversion.',
    action: 'Add opportunity',
    stats: [
      { label: 'Pipeline value', value: '₹2.8Cr', note: '124 open deals' },
      { label: 'Hot leads', value: '46', note: '+11 this week' },
      { label: 'Visits booked', value: '96', note: '7.5% call conversion' },
      { label: 'Won this month', value: '₹38L', note: '14 conversions' },
    ],
    columns: ['Opportunity', 'Stage', 'Score', 'Value', 'Next action'],
    rows: [
      ['Aarav Khanna', 'Site visit', '92 / 100', '₹1.2Cr', 'Tomorrow, 4 PM'],
      ['Ishita Verma', 'Qualified', '88 / 100', '₹85L', 'Send floor plan'],
      ['Kabir Malhotra', 'Negotiation', '84 / 100', '₹1.5Cr', 'Sales call at 6 PM'],
      ['Priya Mehta', 'Follow-up', '76 / 100', '₹72L', 'Callback tomorrow'],
    ],
  },
  Appointments: {
    eyebrow: 'Callback scheduler',
    title: 'Appointments & callbacks',
    description: 'Coordinate booked visits, follow-ups and resource availability.',
    action: 'Book appointment',
    stats: [
      { label: 'Today', value: '28', note: '4 need confirmation' },
      { label: 'Callbacks', value: '34', note: 'next 24 hours' },
      { label: 'Show rate', value: '82%', note: '+5.1% this month' },
      { label: 'Rescheduled', value: '7', note: 'handled automatically' },
    ],
    columns: ['Contact', 'Type', 'Date & time', 'Owner', 'Status'],
    rows: [
      ['Aarav Khanna', 'Site visit', 'Tomorrow, 4:00 PM', 'Riya', 'Confirmed'],
      ['Priya Mehta', 'AI callback', 'Tomorrow, 11:30 AM', 'Arjun', 'Scheduled'],
      ['Ishita Verma', 'Sales call', 'Today, 6:00 PM', 'Karan', 'Confirmed'],
      ['Rohan Sharma', 'Virtual tour', '3 Sep, 2:00 PM', 'Riya', 'Pending'],
    ],
  },
  WhatsApp: {
    eyebrow: 'Unified inbox',
    title: 'WhatsApp follow-ups',
    description: 'Send approved templates, brochures and reminders after calls.',
    action: 'New message',
    stats: [
      { label: 'Sent today', value: '486', note: '98.2% delivered' },
      { label: 'Replies', value: '146', note: '30% response rate' },
      { label: 'Open threads', value: '38', note: '12 need attention' },
      { label: 'Appointments', value: '21', note: 'from WhatsApp today' },
    ],
    columns: ['Contact', 'Last message', 'Template', 'Status', 'Updated'],
    rows: [
      ['Rohan Sharma', 'Thanks, I will review it.', 'Project brochure', 'Read', '3 min ago'],
      ['Aarav Khanna', 'Please share the location.', 'Visit confirmation', 'Replied', '6 min ago'],
      ['Ishita Verma', 'Can we speak after 6?', 'Callback reminder', 'Replied', '12 min ago'],
      ['Neha Kapoor', 'Delivered', 'Follow-up summary', 'Delivered', '18 min ago'],
    ],
  },
  Team: {
    eyebrow: 'Workspace access',
    title: 'Team members',
    description: 'Manage roles, ownership and access across your calling operation.',
    action: 'Invite member',
    stats: [
      { label: 'Team members', value: '12', note: 'of 20 seats' },
      { label: 'Sales owners', value: '7', note: '5 active now' },
      { label: 'Admins', value: '2', note: 'full access' },
      { label: 'Open tasks', value: '34', note: 'across the team' },
    ],
    columns: ['Member', 'Role', 'Assigned leads', 'Conversions', 'Status'],
    rows: [
      ['Riya Kapoor', 'Sales manager', '42', '18', 'Online'],
      ['Karan Shah', 'Sales executive', '36', '12', 'Online'],
      ['Aditi Rao', 'Campaign manager', '—', '—', 'Online'],
      ['Dev Malik', 'Analyst', '—', '—', 'Away'],
    ],
  },
  Billing: {
    eyebrow: 'Usage & wallet',
    title: 'Billing',
    description: 'Monitor connected-minute usage, wallet balance and invoices.',
    action: 'Add funds',
    stats: [
      { label: 'Wallet balance', value: '₹42,860', note: 'auto-recharge on' },
      { label: 'Minutes used', value: '2,728', note: 'of 4,000 included' },
      { label: 'September spend', value: '₹18,704', note: 'AI + telephony' },
      { label: 'Projected bill', value: '₹29,840', note: 'at current usage' },
    ],
    columns: ['Date', 'Description', 'Usage', 'Rate', 'Amount'],
    rows: [
      ['1 Sep', 'Connected call minutes', '1,284 min', '₹6.50', '₹8,346'],
      ['1 Sep', 'WhatsApp conversations', '486', 'Variable', '₹412'],
      ['31 Aug', 'Wallet auto-recharge', '—', '—', '+₹25,000'],
      ['1 Aug', 'Growth plan', '4,000 min', 'Monthly', '₹24,999'],
    ],
  },
  Settings: {
    eyebrow: 'Workspace configuration',
    title: 'Settings & integrations',
    description: 'Control providers, compliance, retention and workspace defaults.',
    action: 'Save changes',
    stats: [
      { label: 'Telephony', value: 'Online', note: 'Exotel primary' },
      { label: 'Speech AI', value: 'Online', note: 'Sarvam streaming' },
      { label: 'WhatsApp', value: 'Online', note: 'Cloud API connected' },
      { label: 'Compliance', value: 'Ready', note: 'consent rules active' },
    ],
    columns: ['Integration', 'Purpose', 'Region', 'Status', 'Last check'],
    rows: [
      ['Exotel', 'Telephony', 'Mumbai', 'Connected', 'Just now'],
      ['Sarvam AI', 'STT · LLM · TTS', 'India', 'Connected', 'Just now'],
      ['Meta', 'WhatsApp Cloud API', 'India', 'Connected', '2 min ago'],
      ['AWS', 'Compute · data · storage', 'ap-south-1', 'Healthy', 'Just now'],
    ],
  },
};

const metrics = [
  {
    label: 'Calls today',
    value: '1,284',
    delta: '+12.5%',
    note: 'vs. yesterday',
    icon: PhoneCall,
  },
  {
    label: 'Connection rate',
    value: '68.4%',
    delta: '+4.2%',
    note: '872 connected',
    icon: PhoneForwarded,
  },
  {
    label: 'Appointments',
    value: '96',
    delta: '+18.1%',
    note: '7.5% conversion',
    icon: CalendarCheck2,
  },
  {
    label: 'Spend today',
    value: '₹8,720',
    delta: '₹6.79',
    note: 'per connected call',
    icon: CircleDollarSign,
  },
];

const callData = [
  { time: '9 AM', connected: 62, appointments: 8 },
  { time: '10 AM', connected: 98, appointments: 11 },
  { time: '11 AM', connected: 87, appointments: 9 },
  { time: '12 PM', connected: 126, appointments: 16 },
  { time: '1 PM', connected: 104, appointments: 12 },
  { time: '2 PM', connected: 141, appointments: 18 },
  { time: '3 PM', connected: 166, appointments: 22 },
  { time: '4 PM', connected: 132, appointments: 17 },
];

const chartConfig = {
  connected: { label: 'Connected calls', color: 'var(--chart-1)' },
  appointments: { label: 'Appointments', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const campaigns = [
  {
    name: 'Gurugram site visits',
    agent: 'Maya · Hinglish',
    status: 'Live',
    progress: 72,
    calls: '438 / 610',
    result: '41 visits',
  },
  {
    name: 'Noida lead reactivation',
    agent: 'Arjun · Hindi',
    status: 'Live',
    progress: 48,
    calls: '192 / 400',
    result: '26 hot leads',
  },
  {
    name: 'Weekend open house',
    agent: 'Maya · English',
    status: 'Scheduled',
    progress: 0,
    calls: 'Starts 5:30 PM',
    result: '850 contacts',
  },
];

const recentCalls = [
  {
    initials: 'AK',
    name: 'Aarav Khanna',
    detail: 'Interested · Site visit booked',
    time: '2m 48s',
    ago: '2 min ago',
    tone: 'bg-emerald-400/15 text-emerald-300',
  },
  {
    initials: 'PM',
    name: 'Priya Mehta',
    detail: 'Callback · Tomorrow, 11:30 AM',
    time: '1m 16s',
    ago: '5 min ago',
    tone: 'bg-sky-400/15 text-sky-300',
  },
  {
    initials: 'RS',
    name: 'Rohan Sharma',
    detail: 'Brochure sent on WhatsApp',
    time: '3m 02s',
    ago: '8 min ago',
    tone: 'bg-amber-400/15 text-amber-300',
  },
];

function ModulePanel({ section }: { section: string }) {
  const data = moduleData[section];

  if (!data) return null;

  return (
    <div className="space-y-5 xl:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1.5 text-xs font-medium text-primary">{data.eyebrow}</p>
          <h2 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[28px]">
            {data.title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {data.description}
          </p>
        </div>
        <Button className="w-full shadow-[0_8px_24px_-10px_var(--primary)] sm:w-auto">
          <Plus /> {data.action}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.stats.map((stat) => (
          <Card key={stat.label} size="sm" className="metric-card">
            <CardHeader>
              <CardDescription className="text-xs">{stat.label}</CardDescription>
              <CardTitle className="pt-2 font-mono text-2xl font-semibold tracking-tight">
                {stat.value}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-[11px] text-muted-foreground">
              {stat.note}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{data.title}</CardTitle>
          <CardDescription>Current workspace data</CardDescription>
          <CardAction>
            <Button size="sm" variant="outline">Filter</Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {data.columns.map((column) => (
                  <TableHead key={column} className="px-4 text-xs text-muted-foreground">
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.join('-')}>
                  {row.map((cell, index) => (
                    <TableCell
                      key={`${cell}-${index}`}
                      className={`px-4 py-3 ${index === 0 ? 'font-medium' : 'text-muted-foreground'}`}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Automation health</CardTitle>
            <CardDescription>Rules and provider checks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              ['Consent & DNC checks', '100%'],
              ['Provider success rate', '99.4%'],
              ['Workflow completion', '97.8%'],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span>{label}</span>
                  <span className="font-mono text-muted-foreground">{value}</span>
                </div>
                <Progress value={Number.parseFloat(value)} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recommended next step</CardTitle>
            <CardDescription>Based on today’s activity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-primary/20 bg-primary/8 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-primary" /> Review high-intent callbacks
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                14 contacts have a lead score above 85 and requested a call in the next 24 hours.
              </p>
              <Button size="sm" variant="outline" className="mt-4">
                Open priority queue <ArrowUpRight />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function Home() {
  const [activeSection, setActiveSection] = useState('Overview');

  return (
    <main className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="hidden border-r border-sidebar-border bg-sidebar lg:flex lg:min-h-screen lg:flex-col">
        <div className="flex h-[76px] items-center gap-3 border-b border-sidebar-border px-5">
          <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_8px_28px_-8px_var(--primary)]">
            <Activity className="size-5" strokeWidth={2.4} />
          </div>
          <div>
            <p className="text-[15px] font-semibold tracking-tight">Vaani</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Voice OS
            </p>
          </div>
        </div>

        <nav aria-label="Primary navigation" className="flex-1 px-3 py-5">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Workspace
          </p>
          <div className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setActiveSection(item.label)}
                className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                  activeSection === item.label
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                }`}
              >
                <item.icon className="size-4" strokeWidth={1.8} />
                {item.label}
                {item.label === 'Calls' && (
                  <span className="ms-auto rounded-md bg-primary/12 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                    12
                  </span>
                )}
              </button>
            ))}
          </div>

          <p className="mb-2 mt-7 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Manage
          </p>
          <div className="space-y-1">
            {managementItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setActiveSection(item.label)}
                className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                  activeSection === item.label
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                }`}
              >
                <item.icon className="size-4" strokeWidth={1.8} /> {item.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="p-3">
          <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/55 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">Growth plan</span>
              <span className="font-mono text-[10px] text-muted-foreground">68%</span>
            </div>
            <Progress value={68} className="[&_[data-slot=progress-indicator]]:bg-primary" />
            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
              2,728 of 4,000 minutes used
            </p>
          </div>
        </div>
      </aside>

      <section className="min-w-0">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-border bg-background/88 px-4 backdrop-blur-xl sm:px-6 xl:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground lg:hidden">
              <Activity className="size-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">
                {activeSection === 'Overview' ? 'Good morning, Sidharth' : activeSection}
              </h1>
              <p className="hidden text-xs text-muted-foreground sm:block">
                {activeSection === 'Overview'
                  ? 'Here’s how your voice team is performing today.'
                  : 'Your AI calling workspace is synced and online.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="hidden h-8 gap-1.5 border-emerald-400/20 bg-emerald-400/8 px-3 text-emerald-300 md:inline-flex"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              12 calls live
            </Badge>
            <Button size="icon" variant="outline" aria-label="Notifications">
              <Bell />
            </Button>
            <button
              type="button"
              aria-label="Open account menu"
              className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-muted"
            >
              <Avatar>
                <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">
                  SK
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" />
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-[1520px] space-y-5 p-4 pb-24 sm:p-6 xl:space-y-6 xl:p-8">
          {activeSection === 'Overview' ? (
            <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>Overview</span>
                <span className="text-border">/</span>
                <span>1 September 2026</span>
              </div>
              <h2 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[28px]">
                Call operations
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="flex-1 sm:flex-none">
                <Headphones /> Test an agent
              </Button>
              <Button className="flex-1 shadow-[0_8px_24px_-10px_var(--primary)] sm:flex-none">
                <Plus /> New campaign
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <Card key={metric.label} className="metric-card" size="sm">
                <CardHeader>
                  <CardDescription className="flex items-center gap-2 text-xs">
                    <metric.icon className="size-3.5" /> {metric.label}
                  </CardDescription>
                  <CardAction>
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-300">
                      {metric.delta}
                      {metric.label !== 'Spend today' && (
                        <ArrowUpRight className="size-3" />
                      )}
                    </span>
                  </CardAction>
                  <CardTitle className="pt-2 font-mono text-2xl font-semibold tracking-tight">
                    {metric.value}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] text-muted-foreground">
                  {metric.note}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.75fr)]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Connected calls</CardTitle>
                <CardDescription>Hourly performance across active campaigns</CardDescription>
                <CardAction className="flex items-center gap-4 pt-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm bg-[var(--chart-1)]" /> Calls
                  </span>
                  <span className="hidden items-center gap-1.5 sm:flex">
                    <span className="size-2 rounded-sm bg-[var(--chart-2)]" /> Bookings
                  </span>
                </CardAction>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={chartConfig}
                  className="h-[260px] w-full min-w-0 aspect-auto"
                  initialDimension={{ width: 760, height: 260 }}
                >
                  <AreaChart data={callData} margin={{ left: -20, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="fillConnected" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-connected)" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="var(--color-connected)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="4 4" />
                    <XAxis dataKey="time" tickLine={false} axisLine={false} tickMargin={12} />
                    <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <Area
                      dataKey="connected"
                      type="monotone"
                      fill="url(#fillConnected)"
                      stroke="var(--color-connected)"
                      strokeWidth={2}
                    />
                    <Area
                      dataKey="appointments"
                      type="monotone"
                      fill="transparent"
                      stroke="var(--color-appointments)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card className="overflow-visible">
              <CardHeader>
                <CardTitle>AI voice team</CardTitle>
                <CardDescription>Live capacity and quality</CardDescription>
                <CardAction>
                  <Badge variant="secondary" className="bg-primary/10 text-primary">
                    3 active
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-3 gap-2 rounded-xl border border-border/75 bg-muted/35 p-3">
                  <div>
                    <p className="font-mono text-lg font-semibold">12</p>
                    <p className="text-[10px] text-muted-foreground">Live calls</p>
                  </div>
                  <div>
                    <p className="font-mono text-lg font-semibold">1.2s</p>
                    <p className="text-[10px] text-muted-foreground">P95 latency</p>
                  </div>
                  <div>
                    <p className="font-mono text-lg font-semibold">94%</p>
                    <p className="text-[10px] text-muted-foreground">QA score</p>
                  </div>
                </div>

                {[
                  ['Maya', 'Hinglish · Real estate', '7 calls', 'bg-violet-400/15 text-violet-300'],
                  ['Arjun', 'Hindi · Follow-ups', '4 calls', 'bg-sky-400/15 text-sky-300'],
                  ['Meera', 'English · Reception', '1 call', 'bg-amber-400/15 text-amber-300'],
                ].map(([name, role, calls, tone]) => (
                  <div key={name} className="flex items-center gap-3">
                    <Avatar className="size-9">
                      <AvatarFallback className={`${tone} text-xs font-semibold`}>
                        {name.slice(0, 1)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-medium">{name}</p>
                        <Sparkles className="size-3 text-primary" />
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">{role}</p>
                    </div>
                    <span className="font-mono text-[11px] text-emerald-300">{calls}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Campaigns in progress</CardTitle>
                <CardDescription>Live delivery and business outcomes</CardDescription>
                <CardAction>
                  <Button variant="ghost" size="sm">View all</Button>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3">
                {campaigns.map((campaign) => (
                  <div
                    key={campaign.name}
                    className="grid gap-3 rounded-xl border border-border/70 p-3.5 transition-colors hover:bg-muted/25 sm:grid-cols-[minmax(0,1fr)_110px_110px] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="mb-1.5 flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{campaign.name}</p>
                        <Badge
                          variant="outline"
                          className={
                            campaign.status === 'Live'
                              ? 'border-emerald-400/20 bg-emerald-400/8 text-emerald-300'
                              : 'border-border text-muted-foreground'
                          }
                        >
                          {campaign.status}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{campaign.agent}</p>
                    </div>
                    <div>
                      <p className="mb-1.5 font-mono text-[11px] text-muted-foreground">{campaign.calls}</p>
                      <Progress value={campaign.progress} />
                    </div>
                    <p className="text-xs font-medium text-foreground sm:text-right">{campaign.result}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent conversations</CardTitle>
                <CardDescription>Latest qualified outcomes</CardDescription>
                <CardAction>
                  <Button variant="ghost" size="sm">Open calls</Button>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-1">
                {recentCalls.map((call) => (
                  <button
                    key={call.name}
                    type="button"
                    aria-label={`Open conversation with ${call.name}`}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/45"
                  >
                    <Avatar className="size-9">
                      <AvatarFallback className={`${call.tone} text-[11px] font-semibold`}>
                        {call.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{call.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{call.detail}</p>
                    </div>
                    <div className="text-right">
                      <p className="flex items-center justify-end gap-1 font-mono text-[11px]">
                        <Clock3 className="size-3 text-muted-foreground" /> {call.time}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{call.ago}</p>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
            </>
          ) : (
            <ModulePanel section={activeSection} />
          )}
        </div>

        <nav
          aria-label="Mobile navigation"
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden"
        >
          {navItems.slice(0, 5).map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setActiveSection(item.label)}
              className={`flex flex-col items-center gap-1 rounded-lg py-1.5 text-[9px] ${
                activeSection === item.label ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <item.icon className="size-[18px]" />
              {item.label}
            </button>
          ))}
        </nav>
      </section>
    </main>
  );
}
