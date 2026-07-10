'use client';

import { useEffect, useState } from 'react';
import { Loader } from 'lucide-react';

type InvitationRow = {
  id: string;
  email: string;
  status: string;
  invitedAt: string;
  signedUpAt: string | null;
  displayStatus: string;
  cleanerId: string | null;
  notes: string | null;
};

type SignupAttempt = {
  id: string;
  email: string;
  success: boolean;
  rejectionReason: string | null;
  createdAt: string;
};

export function CleanerInvitationsClient() {
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [attempts, setAttempts] = useState<SignupAttempt[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch('/api/cleaner-invitations');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Failed to load');
      setInvitations(data.invitations ?? []);
      setAttempts(data.signupAttempts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addInvitation() {
    if (!email.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/cleaner-invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Failed to add email');
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add email');
    } finally {
      setSaving(false);
    }
  }

  async function patchInvitation(id: string, action: 'disable' | 'enable' | 'remove') {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/cleaner-invitations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Update failed');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Cleaner invitations</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage approved cleaner emails, signup status, and rejected attempts.
        </p>
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Add approved email</h2>
        <div className="flex flex-wrap gap-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="cleaner@example.com"
            className="min-w-64 flex-1 rounded-lg border px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={saving}
            onClick={addInvitation}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Add email
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Invited</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Signed up</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {invitations.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">{row.email}</td>
                <td className="px-4 py-3">{row.displayStatus}</td>
                <td className="px-4 py-3 text-gray-500">
                  {new Date(row.invitedAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {row.signedUpAt
                    ? new Date(row.signedUpAt).toLocaleDateString()
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {row.status !== 'disabled' ? (
                      <button
                        type="button"
                        onClick={() => patchInvitation(row.id, 'disable')}
                        className="text-xs font-medium text-amber-700"
                      >
                        Disable
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => patchInvitation(row.id, 'enable')}
                        className="text-xs font-medium text-green-700"
                      >
                        Enable
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => patchInvitation(row.id, 'remove')}
                      className="text-xs font-medium text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Recent signup attempts</h2>
        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Result</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Reason</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {attempts.map((attempt) => (
                <tr key={attempt.id}>
                  <td className="px-4 py-3">{attempt.email}</td>
                  <td className="px-4 py-3">
                    {attempt.success ? 'Accepted' : 'Rejected'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {attempt.rejectionReason ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(attempt.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
