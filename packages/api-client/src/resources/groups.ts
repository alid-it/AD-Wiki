import { z } from 'zod';
import {
  GroupMemberCandidatesQuerySchema,
  GroupMemberUserSchema,
  GroupMembershipSchema,
  GroupSummarySchema,
  OwnGroupMembershipSchema,
  type AddGroupMemberInput,
  type CreateGroupInput,
  type GroupMembership,
  type GroupMemberCandidatesQuery,
  type GroupMemberUser,
  type GroupSummary,
  type OwnGroupMembership,
  type UpdateGroupInput,
  type UpdateGroupMemberInput,
} from '@ad-wiki/shared-types';
import { requestData } from '../http';

/** Alle Gruppen für die globale Verwaltung laden. */
export function list(signal?: AbortSignal): Promise<GroupSummary[]> {
  return requestData(z.array(GroupSummarySchema), '/groups', {
    auth: true,
    signal,
  });
}

/** Eigene Mitgliedschaften ohne Einsicht in fremde Mitglieder laden. */
export function mine(signal?: AbortSignal): Promise<OwnGroupMembership[]> {
  return requestData(z.array(OwnGroupMembershipSchema), '/groups/mine', {
    auth: true,
    signal,
  });
}

export function byId(id: string, signal?: AbortSignal): Promise<GroupSummary> {
  return requestData(GroupSummarySchema, `/groups/${id}`, {
    auth: true,
    signal,
  });
}

export function create(input: CreateGroupInput): Promise<GroupSummary> {
  return requestData(GroupSummarySchema, '/groups', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function update(
  id: string,
  input: UpdateGroupInput,
): Promise<GroupSummary> {
  return requestData(GroupSummarySchema, `/groups/${id}`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

export function remove(id: string): Promise<GroupSummary> {
  return requestData(GroupSummarySchema, `/groups/${id}`, {
    method: 'DELETE',
    auth: true,
  });
}

export function members(
  groupId: string,
  signal?: AbortSignal,
): Promise<GroupMembership[]> {
  return requestData(
    z.array(GroupMembershipSchema),
    `/groups/${groupId}/members`,
    { auth: true, signal },
  );
}

/** Aktive, noch nicht zugeordnete Benutzer innerhalb der Gruppenmanager-Grenze. */
export function memberCandidates(
  groupId: string,
  query: GroupMemberCandidatesQuery = {},
  signal?: AbortSignal,
): Promise<GroupMemberUser[]> {
  const parsed = GroupMemberCandidatesQuerySchema.parse(query);
  const params = new URLSearchParams();
  if (parsed.q) params.set('q', parsed.q);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestData(
    z.array(GroupMemberUserSchema),
    `/groups/${groupId}/member-candidates${suffix}`,
    { auth: true, signal },
  );
}

export function addMember(
  groupId: string,
  input: AddGroupMemberInput,
): Promise<GroupMembership> {
  return requestData(GroupMembershipSchema, `/groups/${groupId}/members`, {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function updateMember(
  groupId: string,
  userId: string,
  input: UpdateGroupMemberInput,
): Promise<GroupMembership> {
  return requestData(
    GroupMembershipSchema,
    `/groups/${groupId}/members/${userId}`,
    {
      method: 'PATCH',
      body: input,
      auth: true,
    },
  );
}

export function removeMember(
  groupId: string,
  userId: string,
): Promise<GroupMembership> {
  return requestData(
    GroupMembershipSchema,
    `/groups/${groupId}/members/${userId}`,
    {
      method: 'DELETE',
      auth: true,
    },
  );
}
