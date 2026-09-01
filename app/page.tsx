'use client';

import { useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Bell,
  Bot,
  BookOpenText,
  Building2,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  ChevronsUpDown,
  CircleDollarSign,
  Clock3,
  ContactRound,
  FileAudio,
  Gauge,
  Globe2,
  Headphones,
  Library,
  LayoutDashboard,
  ListRestart,
  MessageCircleMore,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  Plus,
  Radio,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
  WalletCards,
  Webhook,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

const navigationGroups = [
  {
    label: 'Operate',
    items: [
      { label: 'Overview', icon: LayoutDashboard },
      { label: 'Live calls', icon: PhoneIncoming },
      { label: 'Campaigns', icon: Radio },
      { label: 'Calls', icon: PhoneCall },
      { label: 'Callbacks', icon: ListRestart },
    ],
  },
  {
    label: 'Build',
    items: [
      { label: 'AI agents', icon: Bot },
      { label: 'Knowledge', icon: Library },
      { label: 'Scripts', icon: BookOpenText },
      { label: 'Phone numbers', icon: Globe2 },
    ],
  },
  {
    label: 'Sell',
    items: [
      { label: 'Contacts', icon: ContactRound },
      { label: 'CRM', icon: Target },
      { label: 'Appointments', icon: CalendarCheck2 },
      { label: 'WhatsApp', icon: MessageCircleMore },
    ],
  },
];

const navItems = navigationGroups.flatMap((group) => group.items);

const managementItems = [
  { label: 'Recordings', icon: FileAudio },
  { label: 'Analytics', icon: Gauge },
  { label: 'Team', icon: UsersRound },
  { label: 'Billing', icon: WalletCards },
  { label: 'API & webhooks', icon: Webhook },
  { label: 'Settings', icon: Settings2 },
];

const adminItems = [
  { label: 'Super Admin', icon: ShieldCheck },
  { label: 'Analytics', icon: Gauge },
  { label: 'Billing', icon: WalletCards },
  { label: 'API & webhooks', icon: Webhook },
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
  'Live calls': {
    eyebrow: 'Realtime voice gateway',
    title: 'Live call monitor',
    description:
      'Follow active conversations, latency, intent and transfer readiness in real time.',
    action: 'Listen live',
    stats: [
      { label: 'Live calls', value: '12', note: 'of 30 concurrent' },
      { label: 'P95 latency', value: '1.2s', note: 'within 1.5s target' },
      { label: 'Barge-ins', value: '38', note: 'handled today' },
      { label: 'Transfer ready', value: '3', note: 'high-intent callers' },
    ],
    columns: ['Caller', 'Agent', 'Current intent', 'Duration', 'Latency'],
    rows: [
      ['+91 98••• 4210', 'Maya', 'Site-visit availability', '3m 12s', '1.1s'],
      ['+91 99••• 8184', 'Arjun', 'Price objection', '2m 08s', '1.3s'],
      ['+91 97••• 3309', 'Meera', 'Inbound enquiry', '1m 44s', '0.9s'],
      ['+91 88••• 7062', 'Maya', 'Human transfer', '4m 26s', '1.4s'],
    ],
  },
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
  Knowledge: {
    eyebrow: 'Knowledge base',
    title: 'Business knowledge',
    description:
      'Ground agents with approved websites, PDFs, FAQs, products and pricing.',
    action: 'Add source',
    stats: [
      { label: 'Knowledge sources', value: '18', note: 'all tenant-isolated' },
      { label: 'Approved chunks', value: '1,842', note: 'ready for retrieval' },
      { label: 'Products', value: '24', note: 'pricing synced' },
      { label: 'Last indexed', value: '8m', note: 'ago' },
    ],
    columns: ['Source', 'Type', 'Version', 'Status', 'Updated'],
    rows: [
      ['UrbanNest website', 'Website', 'v12', 'Ready', '8 min ago'],
      ['NCR Projects catalogue', 'PDF · 18 pages', 'v4', 'Ready', 'Yesterday'],
      ['Pricing & offers', 'Product data', 'v9', 'Approved', '1 Sep'],
      ['Sales FAQs', 'FAQ · 86 answers', 'v7', 'Ready', '30 Aug'],
    ],
  },
  Scripts: {
    eyebrow: 'Conversation design',
    title: 'Scripts & guardrails',
    description:
      'Version opening lines, qualification questions, objections and prohibited claims.',
    action: 'Create script',
    stats: [
      { label: 'Published scripts', value: '7', note: '3 languages' },
      { label: 'Objection paths', value: '42', note: 'approved responses' },
      { label: 'Forbidden claims', value: '16', note: 'hard guardrails' },
      { label: 'Test pass rate', value: '98%', note: 'last 100 simulations' },
    ],
    columns: ['Script', 'Objective', 'Language', 'Version', 'Status'],
    rows: [
      [
        'NCR buyer qualification',
        'Book site visit',
        'Hinglish',
        'v8',
        'Published',
      ],
      [
        'Past lead reactivation',
        'Qualify interest',
        'Hindi',
        'v4',
        'Published',
      ],
      ['Inbound receptionist', 'Route enquiry', 'English', 'v3', 'Published'],
      ['Price objection test', 'Handle objection', 'Hinglish', 'v2', 'Draft'],
    ],
  },
  'Phone numbers': {
    eyebrow: 'Telephony',
    title: 'Phone numbers',
    description:
      'Allocate numbers, route inbound calls and control provider capacity.',
    action: 'Add number',
    stats: [
      { label: 'Active numbers', value: '4', note: 'Exotel primary' },
      { label: 'Inbound today', value: '218', note: '71% connected' },
      { label: 'Outbound today', value: '1,066', note: '12 live now' },
      { label: 'Provider health', value: '99.4%', note: 'last 24 hours' },
    ],
    columns: ['Number', 'Assignment', 'Direction', 'Provider', 'Status'],
    rows: [
      [
        '+91 124 498 2201',
        'Maya · Sales',
        'Inbound + outbound',
        'Exotel',
        'Active',
      ],
      [
        '+91 124 498 2202',
        'Arjun · Follow-ups',
        'Outbound',
        'Exotel',
        'Active',
      ],
      ['+91 11 6926 4108', 'Meera · Reception', 'Inbound', 'Exotel', 'Active'],
      [
        '+91 22 6971 3304',
        'Overflow route',
        'Inbound',
        'Backup carrier',
        'Standby',
      ],
    ],
  },
  Campaigns: {
    eyebrow: 'Outbound calling',
    title: 'Campaigns',
    description:
      'Run compliant outreach with calling windows, retries and consent filters.',
    action: 'New campaign',
    stats: [
      { label: 'Live campaigns', value: '2', note: '12 concurrent calls' },
      { label: 'Attempts today', value: '1,284', note: '+12.5% vs yesterday' },
      { label: 'Connected', value: '68.4%', note: '872 conversations' },
      { label: 'Conversions', value: '96', note: 'appointments booked' },
    ],
    columns: ['Campaign', 'Agent', 'Status', 'Progress', 'Outcome'],
    rows: [
      [
        'Gurugram site visits',
        'Maya · Hinglish',
        'Live',
        '438 / 610',
        '41 visits',
      ],
      [
        'Noida lead reactivation',
        'Arjun · Hindi',
        'Live',
        '192 / 400',
        '26 hot leads',
      ],
      [
        'Weekend open house',
        'Maya · English',
        'Scheduled',
        'Starts 5:30 PM',
        '850 contacts',
      ],
    ],
  },
  Calls: {
    eyebrow: 'Conversation intelligence',
    title: 'Call activity',
    description:
      'Review transcripts, recordings, outcomes and follow-up actions.',
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
  Callbacks: {
    eyebrow: 'Durable scheduler',
    title: 'Automatic callbacks',
    description:
      'Resume the original conversation at the customer’s requested date and time.',
    action: 'Schedule callback',
    stats: [
      { label: 'Due today', value: '34', note: '8 in the next hour' },
      { label: 'Confirmed', value: '29', note: 'WhatsApp reminder sent' },
      { label: 'Retry queue', value: '11', note: 'busy or no answer' },
      { label: 'Completion rate', value: '86%', note: 'last 7 days' },
    ],
    columns: ['Contact', 'Scheduled for', 'Context', 'Retry rule', 'Status'],
    rows: [
      [
        'Priya Mehta',
        'Tomorrow, 11:30 AM',
        '2BHK pricing',
        '2 attempts',
        'Confirmed',
      ],
      [
        'Dev Anand',
        'Today, 5:00 PM',
        'Site visit options',
        'Busy · 20 min',
        'Queued',
      ],
      [
        'Ishita Verma',
        'Today, 6:00 PM',
        'Payment plan',
        '3 attempts',
        'Confirmed',
      ],
      [
        'Kabir Malhotra',
        '3 Sep, 10:30 AM',
        'Decision-maker call',
        '2 attempts',
        'Scheduled',
      ],
    ],
  },
  Contacts: {
    eyebrow: 'Audience',
    title: 'Contacts',
    description:
      'Manage consent, segments, call history and suppression status.',
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
    description:
      'Track AI-qualified leads from first conversation to conversion.',
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
      [
        'Kabir Malhotra',
        'Negotiation',
        '84 / 100',
        '₹1.5Cr',
        'Sales call at 6 PM',
      ],
      ['Priya Mehta', 'Follow-up', '76 / 100', '₹72L', 'Callback tomorrow'],
    ],
  },
  Appointments: {
    eyebrow: 'Callback scheduler',
    title: 'Appointments & callbacks',
    description:
      'Coordinate booked visits, follow-ups and resource availability.',
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
      [
        'Priya Mehta',
        'AI callback',
        'Tomorrow, 11:30 AM',
        'Arjun',
        'Scheduled',
      ],
      ['Ishita Verma', 'Sales call', 'Today, 6:00 PM', 'Karan', 'Confirmed'],
      ['Rohan Sharma', 'Virtual tour', '3 Sep, 2:00 PM', 'Riya', 'Pending'],
    ],
  },
  WhatsApp: {
    eyebrow: 'Unified inbox',
    title: 'WhatsApp follow-ups',
    description:
      'Send approved templates, brochures and reminders after calls.',
    action: 'New message',
    stats: [
      { label: 'Sent today', value: '486', note: '98.2% delivered' },
      { label: 'Replies', value: '146', note: '30% response rate' },
      { label: 'Open threads', value: '38', note: '12 need attention' },
      { label: 'Appointments', value: '21', note: 'from WhatsApp today' },
    ],
    columns: ['Contact', 'Last message', 'Template', 'Status', 'Updated'],
    rows: [
      [
        'Rohan Sharma',
        'Thanks, I will review it.',
        'Project brochure',
        'Read',
        '3 min ago',
      ],
      [
        'Aarav Khanna',
        'Please share the location.',
        'Visit confirmation',
        'Replied',
        '6 min ago',
      ],
      [
        'Ishita Verma',
        'Can we speak after 6?',
        'Callback reminder',
        'Replied',
        '12 min ago',
      ],
      [
        'Neha Kapoor',
        'Delivered',
        'Follow-up summary',
        'Delivered',
        '18 min ago',
      ],
    ],
  },
  Recordings: {
    eyebrow: 'Call intelligence',
    title: 'Recordings & transcripts',
    description:
      'Review encrypted recordings, speaker turns, summaries and disposition evidence.',
    action: 'Export records',
    stats: [
      { label: 'Recorded today', value: '872', note: 'consent verified' },
      { label: 'Transcribed', value: '99.7%', note: '3 pending retries' },
      { label: 'Storage', value: '18.6GB', note: '30-day retention' },
      { label: 'QA flagged', value: '14', note: 'needs review' },
    ],
    columns: ['Call', 'Agent', 'Summary', 'Duration', 'QA'],
    rows: [
      ['CALL-98241', 'Maya', 'Qualified · visit booked', '2m 48s', '97%'],
      ['CALL-98240', 'Arjun', 'Callback requested', '1m 16s', '94%'],
      ['CALL-98239', 'Maya', 'Brochure requested', '3m 02s', '95%'],
      ['CALL-98238', 'Meera', 'Routed to sales', '2m 14s', '91%'],
    ],
  },
  Analytics: {
    eyebrow: 'Performance & quality',
    title: 'Analytics',
    description:
      'Measure conversion, language quality, latency, objection trends and true cost.',
    action: 'Create report',
    stats: [
      { label: 'Connected minutes', value: '2,728', note: 'month to date' },
      { label: 'Conversion rate', value: '7.5%', note: '+1.2 pts this month' },
      { label: 'Cost / outcome', value: '₹90.83', note: 'per appointment' },
      { label: 'Agent QA', value: '94%', note: 'across 310 reviews' },
    ],
    columns: [
      'Segment',
      'Attempts',
      'Connect rate',
      'Conversion',
      'Cost / outcome',
    ],
    rows: [
      ['Hinglish · NCR buyers', '634', '72.4%', '9.1%', '₹78.40'],
      ['Hindi · Reactivation', '402', '65.8%', '6.4%', '₹96.20'],
      ['English · Inbound', '218', '81.2%', '12.8%', '₹54.10'],
      ['Overall', '1,284', '68.4%', '7.5%', '₹90.83'],
    ],
  },
  Team: {
    eyebrow: 'Workspace access',
    title: 'Team members',
    description:
      'Manage roles, ownership and access across your calling operation.',
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
  'API & webhooks': {
    eyebrow: 'Developer platform',
    title: 'API & webhooks',
    description:
      'Connect CRM, calendars, product data and downstream business workflows.',
    action: 'Create API key',
    stats: [
      { label: 'Active API keys', value: '3', note: 'scoped access' },
      { label: 'Webhook endpoints', value: '5', note: 'all verified' },
      { label: 'Events today', value: '18.4K', note: '99.8% delivered' },
      { label: 'Failed deliveries', value: '12', note: 'automatic retrying' },
    ],
    columns: ['Endpoint', 'Events', 'Success', 'Last delivery', 'Status'],
    rows: [
      ['CRM lead sync', 'lead.qualified', '99.9%', '18 sec ago', 'Active'],
      ['Booking calendar', 'appointment.*', '100%', '3 min ago', 'Active'],
      ['Warehouse analytics', 'call.completed', '99.7%', '5 min ago', 'Active'],
      [
        'Billing reconciliation',
        'usage.recorded',
        '100%',
        '8 min ago',
        'Active',
      ],
    ],
  },
  Settings: {
    eyebrow: 'Workspace configuration',
    title: 'Settings & integrations',
    description:
      'Control providers, compliance, retention and workspace defaults.',
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
  Onboarding: {
    eyebrow: 'Business setup',
    title: 'Launch your first AI agent',
    description:
      'Complete tenant data, knowledge, voice, compliance and provider checks before activation.',
    action: 'Continue setup',
    stats: [
      { label: 'Setup complete', value: '78%', note: '2 steps remaining' },
      {
        label: 'Knowledge readiness',
        value: '96%',
        note: '18 sources approved',
      },
      { label: 'Compliance', value: 'Ready', note: 'consent rules active' },
      { label: 'Test calls', value: '8 / 10', note: 'quality gate' },
    ],
    columns: ['Setup step', 'Owner', 'Requirement', 'Last update', 'Status'],
    rows: [
      [
        'Business profile',
        'Sidharth',
        'Description · hours · services',
        'Today',
        'Complete',
      ],
      [
        'Knowledge & pricing',
        'Aditi',
        'Website · PDF · catalogue',
        'Today',
        'Complete',
      ],
      [
        'Consent & DNC',
        'Sidharth',
        'Source · purpose · suppression',
        'Yesterday',
        'Complete',
      ],
      [
        'Provider KYC',
        'Sidharth',
        'Exotel number allocation',
        'Pending',
        'Action needed',
      ],
      [
        'Quality acceptance',
        'Aditi',
        '2 more test calls',
        'Today',
        'In progress',
      ],
    ],
  },
  'Super Admin': {
    eyebrow: 'Platform control plane',
    title: 'Super Admin',
    description:
      'Manage tenants, providers, pricing, limits, compliance and platform health.',
    action: 'Add company',
    stats: [
      { label: 'Active companies', value: '38', note: '+4 this month' },
      { label: 'Live calls', value: '186', note: 'of 500 capacity' },
      { label: 'Platform uptime', value: '99.98%', note: 'last 30 days' },
      { label: 'Gross usage', value: '₹18.4L', note: 'month to date' },
    ],
    columns: ['Company', 'Plan', 'Live calls', 'Wallet', 'Risk status'],
    rows: [
      ['UrbanNest Realty', 'Growth', '12', '₹42,860', 'Healthy'],
      ['SmileCare Clinics', 'Business', '28', '₹1,18,420', 'Healthy'],
      ['LearnBridge Academy', 'Growth', '17', '₹36,204', 'Review KYC'],
      ['GlowUp Salons', 'Starter', '6', '₹8,944', 'Healthy'],
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

function ModulePanel({
  section,
  onAction,
}: {
  section: string;
  onAction: () => void;
}) {
  const data = moduleData[section];

  if (!data) return null;

  return (
    <div className="space-y-5 xl:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1.5 text-xs font-medium text-primary">
            {data.eyebrow}
          </p>
          <h2 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[28px]">
            {data.title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {data.description}
          </p>
        </div>
        <Button
          onClick={onAction}
          className="w-full shadow-[0_8px_24px_-10px_var(--primary)] sm:w-auto"
        >
          <Plus /> {data.action}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.stats.map((stat) => (
          <Card key={stat.label} size="sm" className="metric-card">
            <CardHeader>
              <CardDescription className="text-xs">
                {stat.label}
              </CardDescription>
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
            <Button size="sm" variant="outline">
              Filter
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {data.columns.map((column) => (
                  <TableHead
                    key={column}
                    className="px-4 text-xs text-muted-foreground"
                  >
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
                  <span className="font-mono text-muted-foreground">
                    {value}
                  </span>
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
                <Sparkles className="size-4 text-primary" /> Review high-intent
                callbacks
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                14 contacts have a lead score above 85 and requested a call in
                the next 24 hours.
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

function QuickCreateDialog({
  open,
  section,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  section: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (message: string) => void;
}) {
  const data = moduleData[section] ?? moduleData.Campaigns;

  function handleSubmit(event: { preventDefault: () => void }) {
    event.preventDefault();
    onCreated(`${data.action} draft saved successfully.`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{data.action}</DialogTitle>
          <DialogDescription>
            Configure a safe draft. Nothing will call or message a customer
            until compliance checks pass.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-1.5">
            <label htmlFor="draft-name" className="text-xs font-medium">
              Name
            </label>
            <Input
              id="draft-name"
              name="name"
              required
              placeholder={`${section} name`}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="draft-language" className="text-xs font-medium">
                Language
              </label>
              <NativeSelect
                id="draft-language"
                name="language"
                className="w-full"
              >
                <NativeSelectOption value="hinglish">
                  Hindi + English
                </NativeSelectOption>
                <NativeSelectOption value="hindi">Hindi</NativeSelectOption>
                <NativeSelectOption value="english">English</NativeSelectOption>
                <NativeSelectOption value="marathi">Marathi</NativeSelectOption>
                <NativeSelectOption value="tamil">Tamil</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="draft-window" className="text-xs font-medium">
                Calling window
              </label>
              <NativeSelect id="draft-window" name="window" className="w-full">
                <NativeSelectOption value="business">
                  10:00 AM – 7:00 PM
                </NativeSelectOption>
                <NativeSelectOption value="morning">
                  9:00 AM – 1:00 PM
                </NativeSelectOption>
                <NativeSelectOption value="evening">
                  2:00 PM – 8:00 PM
                </NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="draft-objective" className="text-xs font-medium">
              Objective
            </label>
            <Textarea
              id="draft-objective"
              name="objective"
              required
              placeholder="Describe the customer outcome and human-transfer condition."
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/35 p-3">
            <div>
              <p className="text-xs font-medium">
                Require consent verification
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Block contacts without a valid consent record.
              </p>
            </div>
            <Switch defaultChecked aria-label="Require consent verification" />
          </div>
          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">
              <CheckCircle2 /> Save draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Home() {
  const [activeSection, setActiveSection] = useState('Overview');
  const [roleMode, setRoleMode] = useState<'tenant' | 'admin'>('tenant');
  const [composerOpen, setComposerOpen] = useState(false);
  const [notice, setNotice] = useState('');

  return (
    <main className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-sidebar-border bg-sidebar lg:flex lg:flex-col">
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

        <div className="border-b border-sidebar-border p-3">
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-2.5 text-left transition-colors hover:bg-sidebar-accent"
            aria-label="Switch company"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-primary/12 text-primary">
              <Building2 className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">
                {roleMode === 'tenant' ? 'UrbanNest Realty' : 'Vaani Platform'}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {roleMode === 'tenant'
                  ? 'Growth · Gurugram'
                  : '38 active companies'}
              </span>
            </span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </button>
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-sidebar-accent/60 p-1">
            <button
              type="button"
              onClick={() => {
                setRoleMode('tenant');
                setActiveSection('Overview');
              }}
              className={`rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${
                roleMode === 'tenant'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground'
              }`}
            >
              Customer
            </button>
            <button
              type="button"
              onClick={() => {
                setRoleMode('admin');
                setActiveSection('Super Admin');
              }}
              className={`rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${
                roleMode === 'admin'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground'
              }`}
            >
              Super Admin
            </button>
          </div>
        </div>

        <nav
          aria-label="Primary navigation"
          className="flex-1 overflow-y-auto px-3 py-4"
        >
          {roleMode === 'tenant' ? (
            <>
              {navigationGroups.map((group, groupIndex) => (
                <div
                  key={group.label}
                  className={groupIndex === 0 ? '' : 'mt-6'}
                >
                  <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => setActiveSection(item.label)}
                        className={`flex h-8 w-full items-center gap-3 rounded-lg px-3 text-xs transition-colors ${
                          activeSection === item.label
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                        }`}
                      >
                        <item.icon className="size-3.5" strokeWidth={1.8} />
                        {item.label}
                        {item.label === 'Live calls' && (
                          <span className="ms-auto rounded-md bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300">
                            12
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <p className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Manage
              </p>
              <div className="space-y-1">
                {managementItems.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setActiveSection(item.label)}
                    className={`flex h-8 w-full items-center gap-3 rounded-lg px-3 text-xs transition-colors ${
                      activeSection === item.label
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                    }`}
                  >
                    <item.icon className="size-3.5" strokeWidth={1.8} />{' '}
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Platform
              </p>
              {adminItems.map((item) => (
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
                  <item.icon className="size-4" strokeWidth={1.8} />{' '}
                  {item.label}
                </button>
              ))}
            </>
          )}
        </nav>

        <div className="p-3">
          <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/55 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">
                {roleMode === 'tenant' ? 'Growth plan' : 'Platform capacity'}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {roleMode === 'tenant' ? '68%' : '37%'}
              </span>
            </div>
            <Progress
              value={roleMode === 'tenant' ? 68 : 37}
              className="[&_[data-slot=progress-indicator]]:bg-primary"
            />
            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
              {roleMode === 'tenant'
                ? '2,728 of 4,000 minutes used'
                : '186 of 500 concurrent calls'}
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
                {activeSection === 'Overview'
                  ? 'Good morning, Sidharth'
                  : activeSection}
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
          {notice ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/8 px-4 py-3 text-sm text-emerald-200">
              <CheckCircle2 className="size-4" />
              <span className="flex-1">{notice}</span>
              <button
                type="button"
                onClick={() => setNotice('')}
                className="text-xs text-emerald-300/70 hover:text-emerald-200"
              >
                Dismiss
              </button>
            </div>
          ) : null}
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
                  <Button
                    variant="outline"
                    className="flex-1 sm:flex-none"
                    onClick={() => {
                      setActiveSection('AI agents');
                      setComposerOpen(true);
                    }}
                  >
                    <Headphones /> Test an agent
                  </Button>
                  <Button
                    className="flex-1 shadow-[0_8px_24px_-10px_var(--primary)] sm:flex-none"
                    onClick={() => {
                      setActiveSection('Campaigns');
                      setComposerOpen(true);
                    }}
                  >
                    <Plus /> New campaign
                  </Button>
                </div>
              </div>

              <Card className="border-primary/18 bg-[linear-gradient(100deg,color-mix(in_oklab,var(--primary)_9%,var(--card)),var(--card)_62%)]">
                <CardContent className="flex flex-col gap-4 py-0 sm:flex-row sm:items-center">
                  <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                    <ShieldCheck className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <p className="text-sm font-medium">
                        Production readiness
                      </p>
                      <Badge
                        variant="outline"
                        className="border-primary/25 bg-primary/8 text-primary"
                      >
                        78%
                      </Badge>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Consent, knowledge and scripts are ready. Complete
                      provider KYC and two quality test calls before launch.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setActiveSection('Onboarding')}
                  >
                    Continue setup <ArrowUpRight />
                  </Button>
                </CardContent>
              </Card>

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
                    <CardDescription>
                      Hourly performance across active campaigns
                    </CardDescription>
                    <CardAction className="flex items-center gap-4 pt-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-sm bg-[var(--chart-1)]" />{' '}
                        Calls
                      </span>
                      <span className="hidden items-center gap-1.5 sm:flex">
                        <span className="size-2 rounded-sm bg-[var(--chart-2)]" />{' '}
                        Bookings
                      </span>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer
                      config={chartConfig}
                      className="h-[260px] w-full min-w-0 aspect-auto"
                      initialDimension={{ width: 760, height: 260 }}
                    >
                      <AreaChart
                        data={callData}
                        margin={{ left: -20, right: 8, top: 8 }}
                      >
                        <defs>
                          <linearGradient
                            id="fillConnected"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="var(--color-connected)"
                              stopOpacity={0.28}
                            />
                            <stop
                              offset="95%"
                              stopColor="var(--color-connected)"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="4 4" />
                        <XAxis
                          dataKey="time"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={12}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                        />
                        <ChartTooltip
                          cursor={false}
                          content={<ChartTooltipContent />}
                        />
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
                      <Badge
                        variant="secondary"
                        className="bg-primary/10 text-primary"
                      >
                        3 active
                      </Badge>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid grid-cols-3 gap-2 rounded-xl border border-border/75 bg-muted/35 p-3">
                      <div>
                        <p className="font-mono text-lg font-semibold">12</p>
                        <p className="text-[10px] text-muted-foreground">
                          Live calls
                        </p>
                      </div>
                      <div>
                        <p className="font-mono text-lg font-semibold">1.2s</p>
                        <p className="text-[10px] text-muted-foreground">
                          P95 latency
                        </p>
                      </div>
                      <div>
                        <p className="font-mono text-lg font-semibold">94%</p>
                        <p className="text-[10px] text-muted-foreground">
                          QA score
                        </p>
                      </div>
                    </div>

                    {[
                      [
                        'Maya',
                        'Hinglish · Real estate',
                        '7 calls',
                        'bg-violet-400/15 text-violet-300',
                      ],
                      [
                        'Arjun',
                        'Hindi · Follow-ups',
                        '4 calls',
                        'bg-sky-400/15 text-sky-300',
                      ],
                      [
                        'Meera',
                        'English · Reception',
                        '1 call',
                        'bg-amber-400/15 text-amber-300',
                      ],
                    ].map(([name, role, calls, tone]) => (
                      <div key={name} className="flex items-center gap-3">
                        <Avatar className="size-9">
                          <AvatarFallback
                            className={`${tone} text-xs font-semibold`}
                          >
                            {name.slice(0, 1)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-medium">
                              {name}
                            </p>
                            <Sparkles className="size-3 text-primary" />
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {role}
                          </p>
                        </div>
                        <span className="font-mono text-[11px] text-emerald-300">
                          {calls}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle>Campaigns in progress</CardTitle>
                    <CardDescription>
                      Live delivery and business outcomes
                    </CardDescription>
                    <CardAction>
                      <Button variant="ghost" size="sm">
                        View all
                      </Button>
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
                            <p className="truncate text-sm font-medium">
                              {campaign.name}
                            </p>
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
                          <p className="text-[11px] text-muted-foreground">
                            {campaign.agent}
                          </p>
                        </div>
                        <div>
                          <p className="mb-1.5 font-mono text-[11px] text-muted-foreground">
                            {campaign.calls}
                          </p>
                          <Progress value={campaign.progress} />
                        </div>
                        <p className="text-xs font-medium text-foreground sm:text-right">
                          {campaign.result}
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Recent conversations</CardTitle>
                    <CardDescription>Latest qualified outcomes</CardDescription>
                    <CardAction>
                      <Button variant="ghost" size="sm">
                        Open calls
                      </Button>
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
                          <AvatarFallback
                            className={`${call.tone} text-[11px] font-semibold`}
                          >
                            {call.initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {call.name}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {call.detail}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="flex items-center justify-end gap-1 font-mono text-[11px]">
                            <Clock3 className="size-3 text-muted-foreground" />{' '}
                            {call.time}
                          </p>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {call.ago}
                          </p>
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <ModulePanel
              section={activeSection}
              onAction={() => setComposerOpen(true)}
            />
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
              onClick={() => {
                setRoleMode('tenant');
                setActiveSection(item.label);
              }}
              className={`flex flex-col items-center gap-1 rounded-lg py-1.5 text-[9px] ${
                activeSection === item.label
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }`}
            >
              <item.icon className="size-[18px]" />
              {item.label}
            </button>
          ))}
        </nav>
      </section>

      <QuickCreateDialog
        open={composerOpen}
        section={activeSection}
        onOpenChange={setComposerOpen}
        onCreated={setNotice}
      />
    </main>
  );
}
