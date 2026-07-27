import { SetMetadata } from "@nestjs/common";
import type { Action, Resource } from "@ad-wiki/shared-types";

export const PERMISSION_KEY = "required_permission";

export type RequiredPermission = { resource: Resource; action: Action };

/** Declares the ACL permission required by an authenticated route. */
export const RequirePermission = (resource: Resource, action: Action) =>
  SetMetadata(PERMISSION_KEY, { resource, action });

/** Declares multiple ACL permissions that must all be granted. */
export const RequirePermissions = (...permissions: RequiredPermission[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
