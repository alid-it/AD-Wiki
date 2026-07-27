import { z } from 'zod';
import {
  CreatedMcpAccessTokenSchema,
  McpAccessTokenSchema,
  McpOAuthAuthorizationRequestSchema,
  McpOAuthRedirectSchema,
  type CreateMcpAccessTokenInput,
  type CreatedMcpAccessToken,
  type McpAccessToken,
  type McpOAuthAuthorizationRequest,
  type McpOAuthRedirect,
} from '@ad-wiki/shared-types';
import { requestData } from '../http';

/** Eigene MCP-Tokens auflisten. */
export function list(signal?: AbortSignal): Promise<McpAccessToken[]> {
  return requestData(z.array(McpAccessTokenSchema), '/mcp-tokens', { auth: true, signal });
}

/** Token erstellen. Der geheime Klartext wird nur in dieser Antwort geliefert. */
export function create(input: CreateMcpAccessTokenInput): Promise<CreatedMcpAccessToken> {
  return requestData(CreatedMcpAccessTokenSchema, '/mcp-tokens', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

/** Eigenes Token sofort und dauerhaft widerrufen. */
export function revoke(id: string): Promise<McpAccessToken> {
  return requestData(McpAccessTokenSchema, `/mcp-tokens/${id}`, {
    method: 'DELETE',
    auth: true,
  });
}

export function oauthRequest(id: string, signal?: AbortSignal): Promise<McpOAuthAuthorizationRequest> {
  return requestData(McpOAuthAuthorizationRequestSchema, `/mcp/oauth/requests/${encodeURIComponent(id)}`, {
    auth: true,
    signal,
  });
}

export function approveOAuth(id: string): Promise<McpOAuthRedirect> {
  return requestData(McpOAuthRedirectSchema, `/mcp/oauth/requests/${encodeURIComponent(id)}/approve`, {
    method: 'POST', auth: true,
  });
}

export function denyOAuth(id: string): Promise<McpOAuthRedirect> {
  return requestData(McpOAuthRedirectSchema, `/mcp/oauth/requests/${encodeURIComponent(id)}/deny`, {
    method: 'POST', auth: true,
  });
}
