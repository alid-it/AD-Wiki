const JIT_FORBIDDEN_ROLE_RESOURCES = new Set([
  "users",
  "roles",
  "acls",
  "user_permissions",
  "groups",
  "settings",
  "audit_logs",
  "api_keys",
  "smtp",
  "system_info",
  "backups",
  "resource_acls",
]);

interface JitRole {
  name: string;
  acls: ReadonlyArray<{ resource: string }>;
}

/** JIT darf neuen Konten niemals eine administrative Ausgangsrolle geben. */
export function isSafeJitDefaultRole(
  role: JitRole | null | undefined,
): role is JitRole {
  return Boolean(
    role &&
      role.name.toLowerCase() !== "admin" &&
      role.acls.every(
        (entry) => !JIT_FORBIDDEN_ROLE_RESOURCES.has(entry.resource),
      ),
  );
}
