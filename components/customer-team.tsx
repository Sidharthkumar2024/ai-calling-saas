'use client';

import { useState } from 'react';
import {
  Copy,
  Loader2,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type TeamData = {
  members: Array<{
    id: string;
    user_id: string;
    email: string;
    role: string;
    name: string | null;
    status: string | null;
    last_login_at: string | null;
    created_at: string;
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: string;
    expires_at: string;
    created_at: string;
  }>;
  access?: { role: string; permissions: string[] };
  roleCatalog?: Array<{
    id: string;
    label: string;
    description: string;
    permissions: string[];
  }>;
};

export function CustomerTeam({
  data,
  onChanged,
}: {
  data: TeamData;
  onChanged: () => Promise<void> | void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('agent');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [developmentToken, setDevelopmentToken] = useState('');

  async function invite() {
    setLoading('invite');
    setError('');
    setDevelopmentToken('');
    try {
      const payload = (await mutate('POST', { email, role })) as {
        developmentToken?: string;
      };
      setDevelopmentToken(payload.developmentToken ?? '');
      setEmail('');
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to invite member.',
      );
    } finally {
      setLoading('');
    }
  }

  async function updateMember(memberId: string, nextRole: string) {
    setLoading(memberId);
    setError('');
    try {
      await mutate('PATCH', { action: 'role', memberId, role: nextRole });
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to update role.',
      );
    } finally {
      setLoading('');
    }
  }

  async function removeMember(memberId: string) {
    setLoading(memberId);
    setError('');
    try {
      await mutate('PATCH', { action: 'remove', memberId });
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to remove member.',
      );
    } finally {
      setLoading('');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
          Workspace access
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Team and permissions
        </h1>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-ink-muted sm:text-sm">
          Invite operators and assign only the CRM, campaign or analytics access
          they need.
        </p>
      </div>
      <section className="portal-panel p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl border border-hairline bg-surface-strong">
            <UserPlus className="size-4 text-primary" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Invite a teammate</h2>
            <p className="mt-1 text-[10px] text-ink-muted">
              Invitation expires after seven days.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
          <Input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            placeholder="teammate@company.com"
            className="h-11 border-hairline bg-surface-strong"
          />
          <select
            aria-label="Invitation role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="h-11 rounded-xl border border-hairline bg-surface px-3 text-xs text-ink"
          >
            {(data.roleCatalog ?? [])
              .filter((item) => item.id !== 'owner')
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
          </select>
          <Button
            onClick={invite}
            disabled={!email || loading === 'invite'}
            className="portal-primary h-11"
          >
            {loading === 'invite' ? (
              <Loader2 className="animate-spin" />
            ) : (
              <UserPlus />
            )}{' '}
            Invite
          </Button>
        </div>
        {developmentToken ? (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#9eb0ff]/15 bg-primary/6 p-3 text-[10px] text-ink-body">
            <ShieldCheck className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate font-mono">
              Local invite token: {developmentToken}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigator.clipboard.writeText(developmentToken)}
            >
              <Copy className="size-3" />
            </Button>
          </div>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-danger-text">
            {error}
          </p>
        ) : null}
      </section>
      <section className="portal-panel overflow-hidden p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Active members</h2>
            <p className="mt-1 text-[10px] text-ink-muted">
              {data.members.length} people in this isolated tenant
            </p>
          </div>
          <UsersRound className="size-4 text-ink-muted" />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="border-y border-hairline text-[9px] uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="px-3 py-3 font-medium">Member</th>
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Last sign-in</th>
                <th className="px-3 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/7">
              {data.members.map((member) => (
                <tr key={member.id}>
                  <td className="px-3 py-4">
                    <p className="font-medium">{member.name || member.email}</p>
                    <p className="mt-1 text-[9px] text-ink-muted">
                      {member.email}
                    </p>
                  </td>
                  <td className="px-3 py-4">
                    <select
                      aria-label={`Role for ${member.email}`}
                      value={member.role}
                      disabled={
                        loading === member.id || member.role === 'admin'
                      }
                      onChange={(event) =>
                        updateMember(member.id, event.target.value)
                      }
                      className="rounded-lg border border-hairline bg-surface-strong px-2 py-1.5 text-[10px]"
                    >
                      {(data.roleCatalog ?? [])
                        .filter((item) => item.id !== 'owner')
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-4 capitalize text-success-text">
                    {member.status || 'invited'}
                  </td>
                  <td className="px-3 py-4 text-ink-muted">
                    {formatDate(member.last_login_at)}
                  </td>
                  <td className="px-3 py-4 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={
                        loading === member.id || member.role === 'admin'
                      }
                      onClick={() => removeMember(member.id)}
                      aria-label={`Remove ${member.email}`}
                    >
                      {loading === member.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="portal-panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Permission matrix</h2>
            <p className="mt-1 text-[10px] text-ink-muted">
              Your current role:{' '}
              {(data.access?.role ?? 'member').replaceAll('_', ' ')}
            </p>
          </div>
          <ShieldCheck className="size-4 text-primary" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(data.roleCatalog ?? []).map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-hairline bg-surface-muted p-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">{item.label}</p>
                <span className="rounded-md bg-surface-strong px-2 py-1 text-[8px] text-ink-muted">
                  {item.permissions.length} permissions
                </span>
              </div>
              <p className="mt-2 text-[9px] leading-4 text-ink-muted">
                {item.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {item.permissions.map((permission) => (
                  <span
                    key={permission}
                    className="rounded-md border border-hairline px-1.5 py-1 text-[7px] text-ink-muted"
                  >
                    {permission.replace('.', ' · ')}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      {data.invitations.length ? (
        <section className="portal-panel p-5">
          <h2 className="text-sm font-semibold">Pending invitations</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {data.invitations.map((invite) => (
              <div
                key={invite.id}
                className="rounded-xl border border-hairline bg-surface-muted p-4"
              >
                <p className="text-xs font-medium">{invite.email}</p>
                <p className="mt-2 text-[9px] capitalize text-ink-muted">
                  {invite.role.replaceAll('_', ' ')} · expires{' '}
                  {formatDate(invite.expires_at)}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

async function mutate(
  method: 'POST' | 'PATCH',
  payload: Record<string, unknown>,
) {
  const response = await fetch('/api/app/team', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Team request failed.');
  return body;
}
function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
