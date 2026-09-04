import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { loginWithPassword, sessionCookie } from '@/lib/app-auth';
import { hashPassword, sha256 } from '@/lib/security';
import { enforceRateLimit, requestFingerprint } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const supportedUseCases = new Set([
  'sales',
  'commerce_sales',
  'lead_qualification',
  'appointments',
  'customer_support',
  'collections',
]);

const supportedLanguages = new Set([
  'hi-IN',
  'en-IN',
  'hinglish',
  'haryanvi',
  'bn-IN',
  'ta-IN',
  'te-IN',
  'mr-IN',
]);

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const signupLimit = await enforceRateLimit({
      namespace: 'signup',
      identifier: requestFingerprint(request),
      limit: 5,
      windowSeconds: 60 * 60,
    });
    if (!signupLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many account creation attempts. Try again later.' },
        { status: 429 },
      );
    }
    const body = (await request.json()) as {
      name?: string;
      businessName?: string;
      email?: string;
      password?: string;
      phone?: string;
      useCase?: string;
      language?: string;
      inviteToken?: string;
    };
    const name = body.name?.trim();
    const businessName = body.businessName?.trim();
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? '';
    const phone = body.phone?.trim() || null;
    const useCase = supportedUseCases.has(body.useCase ?? '')
      ? body.useCase!
      : 'sales';
    const language = supportedLanguages.has(body.language ?? '')
      ? body.language!
      : 'hi-IN';
    const db = getRawDb();
    const invitation = body.inviteToken
      ? await db
          .prepare(`SELECT i.id, i.organization_id, i.email, i.role, o.name AS organization_name
      FROM team_invitations i INNER JOIN organizations o ON o.id = i.organization_id
      WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ? LIMIT 1`)
          .bind(await sha256(body.inviteToken), new Date().toISOString())
          .first<{
            id: string;
            organization_id: string;
            email: string;
            role: string;
            organization_name: string;
          }>()
      : null;

    if (body.inviteToken && !invitation)
      return NextResponse.json(
        { error: 'Invitation is expired or already used.' },
        { status: 400 },
      );
    if (
      !name ||
      name.length > 80 ||
      (!invitation && (!businessName || businessName.length > 100))
    ) {
      return NextResponse.json(
        { error: 'Your name and business name are required.' },
        { status: 400 },
      );
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Enter a valid email address.' },
        { status: 400 },
      );
    }
    if (invitation && invitation.email.toLowerCase() !== email)
      return NextResponse.json(
        { error: 'Use the email address that received this invitation.' },
        { status: 400 },
      );
    if (
      password.length < 10 ||
      !/[a-zA-Z]/.test(password) ||
      !/\d/.test(password)
    ) {
      return NextResponse.json(
        {
          error:
            'Password must be at least 10 characters with a letter and number.',
        },
        { status: 400 },
      );
    }
    if (phone && !/^\+?[1-9]\d{7,14}$/.test(phone.replaceAll(' ', ''))) {
      return NextResponse.json(
        { error: 'Use a valid phone number with country code.' },
        { status: 400 },
      );
    }

    const existing = await db
      .prepare('SELECT id FROM app_users WHERE lower(email) = ? LIMIT 1')
      .bind(email)
      .first();
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists.' },
        { status: 409 },
      );
    }
    const freePlan = invitation
      ? null
      : await db
          .prepare(
            "SELECT id, included_credits FROM plans WHERE code = 'free' LIMIT 1",
          )
          .first<{ id: string; included_credits: number }>();
    if (!invitation && !freePlan) {
      // Plans were seeded only outside production, so this was the state every
      // production deploy started in, with nothing in the admin panel able to
      // fix it. `plan_create` exists now; say so, rather than leaving an
      // operator with a bare 503.
      return NextResponse.json(
        {
          error:
            'No signup plan is configured on this deployment. A platform admin must create one first.',
        },
        { status: 503 },
      );
    }

    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
    const organizationId = `org_${suffix}`;
    const userId = `user_${suffix}`;
    const memberId = `member_${suffix}`;
    const subscriptionId = `sub_${suffix}`;
    const agentId = `agent_${suffix}`;
    const manualSourceId = `source_manual_${suffix}`;
    const webSourceId = `source_web_${suffix}`;
    const formId = `form_${suffix}`;
    const publicFormKey = `form_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
    const slugBase =
      (businessName ?? invitation?.organization_name ?? 'workspace')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 38) || 'workspace';
    const passwordHash = await hashPassword(password);
    if (invitation) {
      await db.batch([
        db
          .prepare(`INSERT INTO app_users (id, organization_id, name, email, password_hash, role, status)
          VALUES (?, ?, ?, ?, ?, 'customer_agent', 'active')`)
          .bind(userId, invitation.organization_id, name, email, passwordHash),
        db
          .prepare(
            `INSERT INTO organization_members (id, organization_id, user_id, email, role) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            memberId,
            invitation.organization_id,
            userId,
            email,
            invitation.role,
          ),
        db
          .prepare(
            'UPDATE team_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = ? AND accepted_at IS NULL',
          )
          .bind(invitation.id),
      ]);
      const result = await loginWithPassword(email, password);
      if (!result || !('token' in result) || typeof result.token !== 'string')
        throw new Error('Account was created but sign-in could not start.');
      const response = NextResponse.json(
        {
          redirectTo: '/app',
          joinedOrganization: invitation.organization_name,
        },
        { status: 201 },
      );
      response.headers.set(
        'Set-Cookie',
        sessionCookie(result.token, new URL(request.url).protocol === 'https:'),
      );
      return response;
    }
    const welcome =
      language === 'en-IN'
        ? `Hello, this is ${businessName}. Is now a good time for a quick conversation?`
        : `नमस्ते, मैं ${businessName} से बोल रही हूँ. क्या अभी दो मिनट बात कर सकते हैं?`;

    await db.batch([
      db
        .prepare(
          'INSERT INTO organizations (id, slug, name, status) VALUES (?, ?, ?, ?)',
        )
        .bind(
          organizationId,
          `${slugBase}-${suffix.slice(0, 5)}`,
          businessName,
          'active',
        ),
      db
        .prepare(`INSERT INTO app_users
          (id, organization_id, name, email, password_hash, role, status)
          VALUES (?, ?, ?, ?, ?, 'customer_owner', 'active')`)
        .bind(userId, organizationId, name, email, passwordHash),
      db
        .prepare(`INSERT INTO organization_members
          (id, organization_id, user_id, email, role) VALUES (?, ?, ?, ?, 'admin')`)
        .bind(memberId, organizationId, userId, email),
      db
        .prepare(`INSERT INTO subscriptions
          (id, organization_id, plan_id, status) VALUES (?, ?, ?, 'trialing')`)
        .bind(subscriptionId, organizationId, freePlan!.id),
      db
        .prepare(`INSERT INTO organization_wallets
          (organization_id, balance, low_balance_threshold) VALUES (?, ?, 50)`)
        .bind(organizationId, freePlan!.included_credits),
      db
        .prepare(`INSERT INTO credit_ledger
          (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
          VALUES (?, ?, 'trial_grant', ?, ?, 'subscription', ?, 'Welcome trial credits')`)
        .bind(
          `credit_${suffix}`,
          organizationId,
          freePlan!.included_credits,
          freePlan!.included_credits,
          subscriptionId,
        ),
      db
        .prepare(`INSERT INTO onboarding_profiles
          (organization_id, phone, use_case, primary_language, stage)
          VALUES (?, ?, ?, ?, 'agent_test')`)
        .bind(organizationId, phone, useCase, language),
      db
        .prepare(`INSERT INTO lead_sources
          (id, organization_id, type, name, status) VALUES (?, ?, 'manual', 'Manual / CSV', 'connected')`)
        .bind(manualSourceId, organizationId),
      db
        .prepare(`INSERT INTO lead_sources
          (id, organization_id, type, name, status) VALUES (?, ?, 'website_form', 'Website form', 'connected')`)
        .bind(webSourceId, organizationId),
      db
        .prepare(`INSERT INTO lead_forms
          (id, organization_id, name, public_key, fields_json, allowed_domains_json, status)
          VALUES (?, ?, 'Lead capture form', ?, ?, '["http://localhost:3000"]', 'active')`)
        .bind(
          formId,
          organizationId,
          publicFormKey,
          JSON.stringify([
            { key: 'name', label: 'Name', required: true },
            { key: 'phone', label: 'Phone', required: true },
            { key: 'email', label: 'Email', required: false },
          ]),
        ),
      db
        .prepare(`INSERT INTO voice_agents
          (id, organization_id, name, use_case, status, welcome_message, system_prompt,
           primary_language, voice_name, tools_json, extractions_json, calling_config_json)
          VALUES (?, ?, 'Tara', ?, 'draft', ?, ?, ?, 'Vaani Tara', ?, ?, ?)`)
        .bind(
          agentId,
          organizationId,
          useCase,
          welcome,
          'Be concise, natural and multilingual. Understand the customer, answer only from approved information, confirm before acting, and never claim an action succeeded until its tool returns success.',
          language,
          JSON.stringify([
            'send_whatsapp',
            'create_payment_link',
            'schedule_follow_up',
            'book_appointment',
            'transfer_to_human',
          ]),
          JSON.stringify([
            'language',
            'intent',
            'product',
            'amount',
            'payment_timing',
            'next_action',
          ]),
          JSON.stringify({
            inbound: false,
            outbound: false,
            trialMode: true,
            callingWindow: '10:00-19:00 Asia/Kolkata',
          }),
        ),
    ]);

    const result = await loginWithPassword(email, password);
    if (!result || !('token' in result) || typeof result.token !== 'string')
      throw new Error('Account was created but sign-in could not start.');
    const response = NextResponse.json(
      {
        redirectTo: '/app',
        trialCredits: freePlan!.included_credits,
        onboardingStage: 'agent_test',
      },
      { status: 201 },
    );
    response.headers.set(
      'Set-Cookie',
      sessionCookie(result.token, new URL(request.url).protocol === 'https:'),
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to create account.',
      },
      { status: 500 },
    );
  }
}
