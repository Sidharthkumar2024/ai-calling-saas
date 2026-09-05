/**
 * The six starter workflows from §7.1.
 *
 * These are not illustrations. Each one is a real graph that has to survive
 * `validateWorkflow(graph, { mode: 'publish' })` — every exit wired, every
 * path reaching an End — and the test suite asserts exactly that. A template
 * that cannot be published is a screenshot, and this codebase has been
 * removing those.
 *
 * They are starting points, not finished workflows: the object keys, queues
 * and amounts belong to the workspace that installs them, so the builder
 * opens the copy for editing rather than switching it on.
 */

import type { WorkflowGraph, WorkflowNode } from './workflow-nodes.ts';

export type WorkflowTemplate = {
  key: string;
  name: string;
  /** §7.1's own one-line flow, shown on the card. */
  flow: string;
  industry: string;
  graph: WorkflowGraph;
};

function node(
  id: string,
  kind: WorkflowNode['kind'],
  name: string,
  config: Record<string, unknown>,
  next: Record<string, string | null>,
): WorkflowNode {
  return { id, kind, name, config, next };
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: 'admissions',
    name: 'Admissions enquiry',
    industry: 'Education',
    flow: 'Inquiry received → instant qualification → CRM lookup → required documents → admission officer or appointment.',
    graph: {
      nodes: [
        node(
          'start',
          'trigger',
          'Enquiry received',
          { event: 'inbound_call' },
          { next: 'course' },
        ),
        node(
          'course',
          'ask',
          'Which course',
          {
            question: 'Which course are you enquiring about?',
            variable: 'course',
            expect: 'any',
          },
          { next: 'qualify' },
        ),
        node(
          'qualify',
          'ai_decision',
          'Instant qualification',
          {
            instruction:
              'From what the caller has said, are they applying for themselves this intake, applying for a later intake, or only comparing options?',
            outcomes: ['this_intake', 'later_intake', 'comparing'],
          },
          {
            this_intake: 'lookup',
            later_intake: 'nurture',
            comparing: 'nurture',
          },
        ),
        node(
          'lookup',
          'crm_lookup',
          'Existing applicant?',
          {
            entity: 'lead',
            match: 'phone',
            value: '{{caller_phone}}',
            variable: 'lead',
          },
          { found: 'documents', not_found: 'documents' },
        ),
        node(
          'documents',
          'document_request',
          'Required documents',
          {
            document: 'Marksheet and ID proof',
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
          },
          { next: 'officer' },
        ),
        node(
          'officer',
          'human_transfer',
          'Admission officer',
          { skill: 'admissions', reason: 'Applicant for the current intake' },
          { accepted: 'done', no_agent: 'appointment' },
        ),
        node(
          'appointment',
          'booking',
          'Campus appointment',
          {
            service: 'Campus visit',
            when: '{{preferred_slot}}',
            mode: 'in_person',
          },
          { booked: 'done', unavailable: 'callback' },
        ),
        node(
          'nurture',
          'message',
          'Send the prospectus',
          {
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
            body: 'Here is the prospectus for {{course}}. Reply here whenever you would like to speak to an admission officer.',
          },
          { next: 'done' },
        ),
        node(
          'callback',
          'message',
          'Offer a callback',
          {
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
            body: 'No campus slot was free. An admission officer will call you back — reply with a time that suits you.',
          },
          { next: 'done' },
        ),
        node(
          'done',
          'end',
          'Close',
          { disposition: 'admissions_enquiry_handled' },
          {},
        ),
      ],
    },
  },
  {
    key: 'receptionist',
    name: 'AI receptionist',
    industry: 'General',
    flow: 'Call received → intent check → appointment type → requested date and time → availability → slot confirmation.',
    graph: {
      nodes: [
        node(
          'start',
          'trigger',
          'Call received',
          { event: 'inbound_call' },
          { next: 'intent' },
        ),
        node(
          'intent',
          'ai_decision',
          'Why are they calling',
          {
            instruction:
              'Is the caller booking an appointment, asking about an existing one, or asking a general question?',
            outcomes: ['book', 'existing', 'question'],
          },
          { book: 'type', existing: 'lookup', question: 'human' },
        ),
        node(
          'type',
          'ask',
          'Appointment type',
          {
            question: 'What would you like to book?',
            variable: 'service',
            expect: 'any',
          },
          { next: 'when' },
        ),
        node(
          'when',
          'ask',
          'Preferred time',
          {
            question: 'What day and time suits you?',
            variable: 'preferred_slot',
            expect: 'date',
          },
          { next: 'slot' },
        ),
        node(
          'slot',
          'booking',
          'Check availability',
          {
            service: '{{service}}',
            when: '{{preferred_slot}}',
            mode: 'in_person',
          },
          { booked: 'confirm', unavailable: 'alternative' },
        ),
        node(
          'confirm',
          'say',
          'Confirm the slot',
          {
            text: 'You are booked for {{service}} on {{preferred_slot}}. You will get a confirmation message shortly.',
          },
          { next: 'receipt' },
        ),
        node(
          'receipt',
          'message',
          'Send the confirmation',
          {
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
            body: 'Confirmed: {{service}} on {{preferred_slot}}.',
          },
          { next: 'done' },
        ),
        node(
          'alternative',
          'ask',
          'Offer another time',
          {
            question:
              'That time is taken. Would another day or time work for you?',
            variable: 'preferred_slot',
            expect: 'date',
          },
          { next: 'slot' },
        ),
        node(
          'lookup',
          'crm_lookup',
          'Find the appointment',
          {
            entity: 'lead',
            match: 'phone',
            value: '{{caller_phone}}',
            variable: 'lead',
          },
          { found: 'human', not_found: 'human' },
        ),
        node(
          'human',
          'human_transfer',
          'Reception desk',
          { reason: 'General enquiry or existing appointment' },
          { accepted: 'done', no_agent: 'callbackMsg' },
        ),
        node(
          'callbackMsg',
          'message',
          'Nobody free',
          {
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
            body: 'Sorry we missed you — reception will call you back shortly.',
          },
          { next: 'done' },
        ),
        node('done', 'end', 'Close', { disposition: 'reception_handled' }, {}),
      ],
    },
  },
  {
    key: 'hospitality',
    name: 'Hospitality booking',
    industry: 'Hospitality',
    flow: 'Booking inquiry → group size → room or service availability → confirmation → message or email.',
    graph: {
      nodes: [
        node(
          'start',
          'trigger',
          'Booking enquiry',
          { event: 'inbound_call' },
          { next: 'size' },
        ),
        node(
          'size',
          'ask',
          'Group size',
          {
            question: 'How many guests will be staying?',
            variable: 'group_size',
            expect: 'number',
          },
          { next: 'dates' },
        ),
        node(
          'dates',
          'ask',
          'Dates',
          {
            question: 'Which dates are you looking at?',
            variable: 'stay_dates',
            expect: 'date',
          },
          { next: 'rooms' },
        ),
        node(
          'rooms',
          'object_search',
          'Room availability',
          {
            object: 'rooms',
            filters: ['capacity>={{group_size}}', 'status=available'],
            variable: 'matches',
          },
          { found: 'offer', none: 'waitlist' },
        ),
        node(
          'offer',
          'say',
          'Offer what is free',
          {
            text: 'I have {{matches.count}} options for {{group_size}} guests on {{stay_dates}}.',
          },
          { next: 'hold' },
        ),
        node(
          'hold',
          'booking',
          'Hold the room',
          {
            service: 'Room booking',
            when: '{{stay_dates}}',
            mode: 'in_person',
          },
          { booked: 'deposit', unavailable: 'waitlist' },
        ),
        node(
          'deposit',
          'payment',
          'Deposit link',
          {
            amount: '{{deposit_amount}}',
            purpose: 'Booking deposit',
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
          },
          { next: 'confirmation' },
        ),
        node(
          'confirmation',
          'message',
          'Send the confirmation',
          {
            channel: 'email',
            body: 'Your booking for {{group_size}} guests on {{stay_dates}} is held. The deposit link is in this message.',
          },
          { next: 'done' },
        ),
        node(
          'waitlist',
          'message',
          'Waitlist them',
          {
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
            body: 'Nothing is free for {{group_size}} guests on {{stay_dates}}. We will message you the moment something opens.',
          },
          { next: 'done' },
        ),
        node(
          'done',
          'end',
          'Close',
          { disposition: 'booking_enquiry_handled' },
          {},
        ),
      ],
    },
  },
  {
    key: 'kyc',
    name: 'Finance / KYC resume',
    industry: 'Financial services',
    flow: 'Incomplete KYC → reason → document availability → consent to resume → upload and verification → human if required.',
    graph: {
      nodes: [
        node(
          'start',
          'trigger',
          'Incomplete KYC',
          { event: 'outbound_campaign' },
          { next: 'lookup' },
        ),
        node(
          'lookup',
          'crm_lookup',
          'Find the applicant',
          {
            entity: 'lead',
            match: 'phone',
            value: '{{caller_phone}}',
            variable: 'lead',
          },
          { found: 'reason', not_found: 'noRecord' },
        ),
        node(
          'reason',
          'ask',
          'Why it stalled',
          {
            question:
              'Your verification is incomplete. What stopped you from finishing it?',
            variable: 'stall_reason',
            expect: 'any',
          },
          { next: 'consent' },
        ),
        node(
          'consent',
          'ask',
          'Consent to resume',
          {
            question: 'Would you like to finish the verification now?',
            variable: 'consent',
            expect: 'yes_no',
          },
          { next: 'consented' },
        ),
        node(
          'consented',
          'condition',
          'Did they agree',
          { expression: 'consent = yes' },
          { true: 'documents', false: 'declined' },
        ),
        node(
          'documents',
          'document_request',
          'Upload link',
          {
            document: 'Identity and address proof',
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
          },
          { next: 'verify' },
        ),
        node(
          'verify',
          'approval',
          'Verification check',
          {
            action: 'kyc_verification',
            reason: 'Documents submitted on a resumed KYC call',
          },
          { approved: 'verified', rejected: 'human' },
        ),
        node(
          'verified',
          'message',
          'Tell them it passed',
          {
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
            body: 'Your verification is complete. Nothing further is needed.',
          },
          { next: 'done' },
        ),
        node(
          'human',
          'human_transfer',
          'Compliance officer',
          {
            skill: 'compliance',
            reason: 'Verification could not be completed automatically',
          },
          { accepted: 'done', no_agent: 'callback' },
        ),
        node(
          'declined',
          'message',
          'Leave the door open',
          {
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
            body: 'No problem. Your verification link stays open — use it whenever you are ready.',
          },
          { next: 'done' },
        ),
        node(
          'callback',
          'message',
          'Compliance will call',
          {
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
            body: 'A compliance officer will call you back to finish the verification.',
          },
          { next: 'done' },
        ),
        node(
          'noRecord',
          'end',
          'No matching applicant',
          { disposition: 'kyc_no_record' },
          {},
        ),
        node('done', 'end', 'Close', { disposition: 'kyc_resume_handled' }, {}),
      ],
    },
  },
  {
    key: 'hiring',
    name: 'Hiring screen',
    industry: 'Recruitment',
    flow: 'Profile under review → eligibility → graduation year and experience → interview availability → schedule.',
    graph: {
      nodes: [
        node(
          'start',
          'trigger',
          'Profile under review',
          { event: 'outbound_campaign' },
          { next: 'intro' },
        ),
        node(
          'intro',
          'say',
          'Why we are calling',
          {
            text: 'Your profile is under review for the role you applied to. May I ask two quick questions?',
          },
          { next: 'graduation' },
        ),
        node(
          'graduation',
          'ask',
          'Graduation year',
          {
            question: 'Which year did you graduate?',
            variable: 'graduation_year',
            expect: 'number',
          },
          { next: 'experience' },
        ),
        node(
          'experience',
          'ask',
          'Years of experience',
          {
            question: 'How many years of relevant experience do you have?',
            variable: 'experience',
            expect: 'number',
          },
          { next: 'eligible' },
        ),
        node(
          'eligible',
          'condition',
          'Eligibility',
          { expression: 'experience >= 2' },
          { true: 'availability', false: 'keepOnFile' },
        ),
        node(
          'availability',
          'ask',
          'Interview availability',
          {
            question: 'When are you free for a 30 minute interview?',
            variable: 'preferred_slot',
            expect: 'date',
          },
          { next: 'schedule' },
        ),
        node(
          'schedule',
          'booking',
          'Schedule the interview',
          { service: 'Interview', when: '{{preferred_slot}}', mode: 'video' },
          { booked: 'invite', unavailable: 'recruiter' },
        ),
        node(
          'invite',
          'message',
          'Send the invite',
          {
            channel: 'email',
            body: 'Your interview is scheduled for {{preferred_slot}}. The joining link is in this message.',
          },
          { next: 'done' },
        ),
        node(
          'recruiter',
          'human_transfer',
          'Recruiter',
          {
            skill: 'recruitment',
            reason: 'No interview slot matched the candidate',
          },
          { accepted: 'done', no_agent: 'done' },
        ),
        node(
          'keepOnFile',
          'message',
          'Keep on file',
          {
            channel: 'email',
            body: 'Thank you for your time. We will keep your profile on file for roles that match your experience.',
          },
          { next: 'done' },
        ),
        node('done', 'end', 'Close', { disposition: 'screening_complete' }, {}),
      ],
    },
  },
  {
    key: 'sales',
    name: 'Sales qualification',
    industry: 'Sales',
    flow: 'Lead received → qualification → score → pitch → objection → demo, appointment, payment or handoff.',
    graph: {
      nodes: [
        node(
          'start',
          'trigger',
          'Lead received',
          { event: 'outbound_campaign' },
          { next: 'lookup' },
        ),
        node(
          'lookup',
          'crm_lookup',
          'Find the lead',
          {
            entity: 'lead',
            match: 'phone',
            value: '{{caller_phone}}',
            variable: 'lead',
          },
          { found: 'need', not_found: 'need' },
        ),
        node(
          'need',
          'ask',
          'What they need',
          {
            question: 'What are you looking for?',
            variable: 'need',
            expect: 'any',
          },
          { next: 'qualify' },
        ),
        node(
          'qualify',
          'ai_decision',
          'Qualification',
          {
            instruction:
              'Is this caller ready to buy now, interested but not yet decided, or not a fit for what we sell?',
            outcomes: ['ready', 'interested', 'not_a_fit'],
          },
          { ready: 'score', interested: 'pitch', not_a_fit: 'polite' },
        ),
        node(
          'score',
          'condition',
          'Score gate',
          { expression: 'lead.score >= 60' },
          { true: 'payment', false: 'pitch' },
        ),
        node(
          'pitch',
          'say',
          'Pitch',
          {
            text: 'Here is what we can do for {{need}} — and I can hold a demo slot for you today.',
          },
          { next: 'objection' },
        ),
        node(
          'objection',
          'ai_decision',
          'Objection',
          {
            instruction:
              'What is holding the caller back — price, timing, trust, or nothing?',
            outcomes: ['price', 'timing', 'trust', 'none'],
          },
          { price: 'approval', timing: 'demo', trust: 'handoff', none: 'demo' },
        ),
        node(
          'approval',
          'approval',
          'Discount approval',
          {
            action: 'discount',
            amount: '{{requested_discount}}',
            reason: 'Price objection on a qualified lead',
          },
          { approved: 'payment', rejected: 'demo' },
        ),
        node(
          'demo',
          'booking',
          'Book a demo',
          {
            service: 'Product demo',
            when: '{{preferred_slot}}',
            mode: 'video',
          },
          { booked: 'confirm', unavailable: 'handoff' },
        ),
        node(
          'payment',
          'payment',
          'Payment link',
          {
            amount: '{{quoted_amount}}',
            purpose: '{{need}}',
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
          },
          { next: 'confirm' },
        ),
        node(
          'handoff',
          'human_transfer',
          'Sales executive',
          { skill: 'sales', reason: 'Needs a person to close' },
          { accepted: 'done', no_agent: 'confirm' },
        ),
        node(
          'confirm',
          'message',
          'Follow up in writing',
          {
            channel: 'whatsapp',
            destination: '{{caller_phone}}',
            body: 'Thanks for your time — everything we discussed about {{need}} is in this message.',
          },
          { next: 'done' },
        ),
        node(
          'polite',
          'say',
          'Close politely',
          {
            text: 'Thank you for your time — it sounds like this is not the right fit today.',
          },
          { next: 'done' },
        ),
        node(
          'done',
          'end',
          'Close',
          {
            disposition: 'sales_call_complete',
            followUp: 'Review in the pipeline',
          },
          {},
        ),
      ],
    },
  },
];

export function templateByKey(key: string) {
  return WORKFLOW_TEMPLATES.find((template) => template.key === key) ?? null;
}
