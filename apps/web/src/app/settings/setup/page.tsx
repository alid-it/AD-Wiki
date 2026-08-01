'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  Clipboard,
  Cloud,
  Code2,
  Copy,
  Database,
  DatabaseBackup,
  ExternalLink,
  Fingerprint,
  FolderSync,
  FolderKanban,
  GitBranch,
  HardDrive,
  KeyRound,
  Link2,
  ListChecks,
  LockKeyhole,
  Network,
  Plug,
  Server,
  ShieldCheck,
  TimerReset,
  Terminal,
  UserCog,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

type GuideTab = 'access' | 'identity' | 'mcp' | 'integrations' | 'backups' | 'monitoring';
type GuideIcon = typeof BookOpen;

const MCP_TOOL_GROUPS = [
  {
    key: 'overview',
    tools: [
      ['list_knowledge', 'pages:read / notes:read / standards:read'],
      ['search_knowledge', 'pages:read / notes:read / standards:read'],
    ],
  },
  {
    key: 'wiki',
    tools: [
      ['list_pages', 'pages:read'],
      ['search_wiki', 'pages:read'],
      ['read_page', 'pages:read'],
    ],
  },
  {
    key: 'notes',
    tools: [
      ['search_notes', 'notes:read'],
      ['read_note', 'notes:read'],
    ],
  },
  {
    key: 'standards',
    tools: [
      ['list_active_standards', 'standards:read'],
      ['search_standards', 'standards:read'],
      ['read_standard', 'standards:read'],
    ],
  },
  {
    key: 'quality',
    tools: [
      ['evaluate_against_standards', 'standards:read'],
      ['detect_source_conflicts', 'standards:read'],
      ['classify_content', 'mcp:read'],
      ['suggest_tags', 'pages:read / notes:read / standards:read'],
      ['suggest_category', 'categories:read'],
    ],
  },
  {
    key: 'write',
    tools: [
      ['create_page', 'pages:create'],
      ['update_page', 'pages:update'],
      ['create_note', 'notes:create'],
      ['update_note', 'notes:update'],
      ['create_standard_draft', 'standards:create'],
    ],
  },
] as const;

const INTEGRATION_RIGHTS = [
  ['read', 'integrations:read'],
  ['create', 'integrations:create'],
  ['update', 'integrations:update'],
  ['delete', 'integrations:delete'],
] as const;

const BACKUP_RIGHTS = [
  ['read', 'backups:read'],
  ['create', 'backups:create'],
  ['update', 'backups:update'],
  ['delete', 'backups:delete'],
  ['run', 'backups:run'],
  ['restore', 'backups:restore'],
] as const;

const DEV_CALLBACK = 'http://localhost:4000/api/v1/integrations/microsoft/callback';
const PROD_CALLBACK = 'https://wiki.example.com/api/v1/integrations/microsoft/callback';
const MCP_EXAMPLE_ENDPOINT = 'https://wiki.example.com/mcp';
const MONITORING_BASE_URL = 'https://wiki.example.com';

const MONITORING_METRIC_GROUPS = [
  {
    key: 'availability',
    metrics: ['ad_wiki_dependency_up', 'ad_wiki_api_uptime_seconds'],
  },
  {
    key: 'backups',
    metrics: [
      'ad_wiki_backup_stale',
      'ad_wiki_backup_latest_failure_open',
      'ad_wiki_backup_worker_up',
      'ad_wiki_backup_overdue_plans',
    ],
  },
  {
    key: 'capacity',
    metrics: ['ad_wiki_upload_filesystem_free_ratio', 'ad_wiki_media_bytes'],
  },
  {
    key: 'security',
    metrics: [
      'ad_wiki_login_attempts_total',
      'ad_wiki_security_http_responses_total',
      'ad_wiki_api_key_auth_attempts_total',
      'ad_wiki_mcp_requests_total',
    ],
  },
  {
    key: 'services',
    metrics: [
      'ad_wiki_smtp_delivery_attempts_total',
      'ad_wiki_audit_write_attempts_total',
      'ad_wiki_tls_certificate_days_remaining',
    ],
  },
] as const;

export default function SetupGuidePage() {
  const t = useTranslations('settings.setup');
  const { hasPermission } = useAuth();
  const endpoint = MCP_EXAMPLE_ENDPOINT;
  const [activeTab, setActiveTab] = useState<GuideTab>('mcp');
  const canReadAccess =
    hasPermission('roles', 'read') ||
    hasPermission('groups', 'read') ||
    hasPermission('groups', 'manage_members') ||
    hasPermission('spaces', 'read') ||
    hasPermission('resource_acls', 'read');
  const canReadMcp = hasPermission('mcp', 'read');
  const canReadIdentity = hasPermission('settings', 'read');
  const canReadIntegrations = hasPermission('integrations', 'read');
  const canReadBackups = hasPermission('backups', 'read');
  const canReadMonitoring = hasPermission('system_info', 'read');
  const availableTabs = useMemo<GuideTab[]>(() => {
    const tabs: GuideTab[] = [];
    if (canReadAccess) tabs.push('access');
    if (canReadIdentity) tabs.push('identity');
    if (canReadMcp) tabs.push('mcp');
    if (canReadIntegrations) tabs.push('integrations');
    if (canReadBackups) tabs.push('backups');
    if (canReadMonitoring) tabs.push('monitoring');
    return tabs;
  }, [
    canReadAccess,
    canReadBackups,
    canReadIntegrations,
    canReadIdentity,
    canReadMcp,
    canReadMonitoring,
  ]);
  const resolvedActiveTab = availableTabs.includes(activeTab) ? activeTab : availableTabs[0] ?? 'mcp';

  useEffect(() => {
    const syncHash = () => {
      const hash = window.location.hash.slice(1) as GuideTab;
      setActiveTab(availableTabs.includes(hash) ? hash : availableTabs[0] ?? 'mcp');
    };
    syncHash();
    window.addEventListener('hashchange', syncHash);
    window.addEventListener('popstate', syncHash);
    return () => {
      window.removeEventListener('hashchange', syncHash);
      window.removeEventListener('popstate', syncHash);
    };
  }, [availableTabs]);

  function selectTab(tab: GuideTab) {
    setActiveTab(tab);
    window.history.pushState({}, '', `${window.location.pathname}#${tab}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="bg-gradient-to-br from-accent-50 via-surface to-brand-50 p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-600 text-white shadow-sm">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">{t('heading')}</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{t('description')}</p>
            </div>
          </div>
        </div>

        <div role="tablist" aria-label={t('tabLabel')} className="grid grid-cols-2 gap-1 border-t border-border bg-surface p-1.5 md:grid-cols-3 xl:grid-cols-6">
          {canReadAccess && (
            <TabButton tab="access" active={resolvedActiveTab === 'access'} icon={ShieldCheck} onClick={() => selectTab('access')}>
              {t('tabAccess')}
            </TabButton>
          )}
          {canReadIdentity && (
            <TabButton tab="identity" active={resolvedActiveTab === 'identity'} icon={Fingerprint} onClick={() => selectTab('identity')}>
              {t('tabIdentity')}
            </TabButton>
          )}
          {canReadMcp && (
            <TabButton tab="mcp" active={resolvedActiveTab === 'mcp'} icon={KeyRound} onClick={() => selectTab('mcp')}>
              {t('tabMcp')}
            </TabButton>
          )}
          {canReadIntegrations && (
            <TabButton tab="integrations" active={resolvedActiveTab === 'integrations'} icon={Plug} onClick={() => selectTab('integrations')}>
              {t('tabIntegrations')}
            </TabButton>
          )}
          {canReadBackups && (
            <TabButton tab="backups" active={resolvedActiveTab === 'backups'} icon={DatabaseBackup} onClick={() => selectTab('backups')}>
              {t('tabBackups')}
            </TabButton>
          )}
          {canReadMonitoring && (
            <TabButton tab="monitoring" active={resolvedActiveTab === 'monitoring'} icon={Activity} onClick={() => selectTab('monitoring')}>
              {t('tabMonitoring')}
            </TabButton>
          )}
        </div>
      </header>

      {resolvedActiveTab === 'access' && <AccessGuide />}
      {resolvedActiveTab === 'identity' && <IdentityProviderGuide />}
      {resolvedActiveTab === 'mcp' && <McpGuide endpoint={endpoint} />}
      {resolvedActiveTab === 'integrations' && <IntegrationGuide />}
      {resolvedActiveTab === 'backups' && <BackupGuide />}
      {resolvedActiveTab === 'monitoring' && <MonitoringGuide />}
    </div>
  );
}

function IdentityProviderGuide() {
  const t = useTranslations('settings.setup');
  const callback = 'https://wiki.example.com/api/v1/auth/oidc/PROVIDER-SLUG/callback';

  return (
    <div id="setup-panel-identity" role="tabpanel" aria-labelledby="setup-tab-identity" className="flex flex-col gap-5">
      <GuideSection icon={Fingerprint} title={t('identity.modelTitle')} description={t('identity.modelDescription')}>
        <div className="grid gap-3 md:grid-cols-3">
          <InfoTile icon={ShieldCheck} title={t('identity.authenticationTitle')}>{t('identity.authenticationText')}</InfoTile>
          <InfoTile icon={UsersRound} title={t('identity.mappingTitle')}>{t('identity.mappingText')}</InfoTile>
          <InfoTile icon={LockKeyhole} title={t('identity.authorizationTitle')}>{t('identity.authorizationText')}</InfoTile>
        </div>
        <Callout>{t('identity.emergencyHint')}</Callout>
      </GuideSection>

      <GuideSection icon={Cloud} title={t('identity.entraTitle')} description={t('identity.entraDescription')}>
        <div className="grid gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((step) => (
            <InstructionCard key={step} number={String(step)} title={t(`identity.entraSteps.${step}.title`)}>
              <p>{t(`identity.entraSteps.${step}.text`)}</p>
              {step === 7 && <CodeBlock label={t('identity.redirectLabel')} value={callback} />}
            </InstructionCard>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Fact label={t('identity.entraTenantIdLabel')} value="00000000-0000-0000-0000-000000000000" />
          <Fact label={t('identity.entraIssuerLabel')} value="https://login.microsoftonline.com/{TENANT-ID}/v2.0" />
          <Fact label={t('identity.entraClientIdLabel')} value={t('identity.entraClientIdValue')} />
          <Fact label={t('identity.providerSlugLabel')} value={t('identity.providerSlugValue')} />
          <Fact label={t('identity.entraScopesLabel')} value="openid profile email User.Read" />
          <Fact label={t('identity.entraGroupClaimLabel')} value="groups (Object-ID)" />
          <Fact label={t('identity.entraRoleClaimLabel')} value="roles (App-Rollen)" />
        </div>
        <Callout>{t('identity.slugExplanation')}</Callout>
        <Callout warning>{t('identity.jitWarning')}</Callout>
        <Callout warning>{t('identity.entraOverageWarning')}</Callout>
        <div className="mt-4">
          <Link href="/settings/identity-providers" className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2">
            <Fingerprint className="h-4 w-4" aria-hidden="true" />
            {t('identity.openProviders')}
          </Link>
        </div>
      </GuideSection>

      <GuideSection icon={Server} title={t('identity.keycloakTitle')} description={t('identity.keycloakDescription')}>
        <div className="grid gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((step) => (
            <InstructionCard key={step} number={String(step)} title={t(`identity.keycloakSteps.${step}.title`)}>
              <p>{t(`identity.keycloakSteps.${step}.text`)}</p>
            </InstructionCard>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Fact label={t('identity.keycloakIssuerLabel')} value="https://sso.example.com/realms/ad-wiki" />
          <Fact label={t('identity.keycloakMapperLabel')} value="Group Membership · Token Claim Name: groups · Full group path: On" />
        </div>
        <Callout>{t('identity.keycloakLdapHint')}</Callout>
      </GuideSection>

      <GuideSection icon={Network} title={t('identity.genericTitle')} description={t('identity.genericDescription')}>
        <ul className="space-y-3 text-sm text-muted">
          <Bullet>{t('identity.genericDiscovery')}</Bullet>
          <Bullet>{t('identity.genericClaims')}</Bullet>
          <Bullet>{t('identity.genericRedirect')}</Bullet>
          <Bullet>{t('identity.genericPkce')}</Bullet>
        </ul>
      </GuideSection>

      <GuideSection icon={Activity} title={t('identity.testTitle')} description={t('identity.testDescription')}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <InfoTile icon={Cloud} title={t('identity.testDiscoveryTitle')}>{t('identity.testDiscoveryText')}</InfoTile>
          <InfoTile icon={LockKeyhole} title={t('identity.testTlsTitle')}>{t('identity.testTlsText')}</InfoTile>
          <InfoTile icon={KeyRound} title={t('identity.testJwksTitle')}>{t('identity.testJwksText')}</InfoTile>
          <InfoTile icon={Link2} title={t('identity.testEndpointsTitle')}>{t('identity.testEndpointsText')}</InfoTile>
        </div>
        <Callout warning>{t('identity.secretHint')}</Callout>
      </GuideSection>
    </div>
  );
}

function AccessGuide() {
  const t = useTranslations('settings.setup');

  return (
    <div
      id="setup-panel-access"
      role="tabpanel"
      aria-labelledby="setup-tab-access"
      className="flex flex-col gap-5"
    >
      <GuideSection
        icon={ShieldCheck}
        title={t('access.modelTitle')}
        description={t('access.modelDescription')}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <InfoTile icon={ShieldCheck} title={t('access.roleTitle')}>
            {t('access.roleText')}
          </InfoTile>
          <InfoTile icon={UsersRound} title={t('access.groupTitle')}>
            {t('access.groupText')}
          </InfoTile>
          <InfoTile icon={FolderKanban} title={t('access.spaceTitle')}>
            {t('access.spaceText')}
          </InfoTile>
          <InfoTile icon={GitBranch} title={t('access.aclTitle')}>
            {t('access.aclText')}
          </InfoTile>
        </div>
        <Callout>{t('access.formula')}</Callout>
      </GuideSection>

      <GuideSection
        icon={ListChecks}
        title={t('access.workflowTitle')}
        description={t('access.workflowDescription')}
      >
        <ol className="grid gap-3 lg:grid-cols-2">
          {[1, 2, 3, 4, 5, 6].map((step) => (
            <li
              key={step}
              className="flex gap-3 rounded-xl border border-border bg-background p-4"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-600 text-xs font-bold text-white">
                {step}
              </span>
              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  {t(`access.steps.${step}.title`)}
                </h4>
                <p className="mt-1 text-sm leading-6 text-muted">
                  {t(`access.steps.${step}.text`)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </GuideSection>

      <GuideSection
        icon={FolderKanban}
        title={t('access.spaceSettingsTitle')}
        description={t('access.spaceSettingsDescription')}
      >
        <div className="overflow-hidden rounded-xl border border-border">
          {(['visibility', 'kinds', 'responsible', 'rules'] as const).map(
            (key) => (
              <div
                key={key}
                className="grid gap-1 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[190px_1fr] sm:gap-4"
              >
                <p className="text-sm font-semibold text-foreground">
                  {t(`access.spaceSettings.${key}.title`)}
                </p>
                <p className="text-sm leading-6 text-muted">
                  {t(`access.spaceSettings.${key}.text`)}
                </p>
              </div>
            ),
          )}
        </div>
        <Callout warning>{t('access.responsibilityWarning')}</Callout>
      </GuideSection>

      <GuideSection
        icon={GitBranch}
        title={t('access.ruleTitle')}
        description={t('access.ruleDescription')}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={t('access.recipient')} value={t('access.recipientValue')} />
          <Fact label={t('access.action')} value={t('access.actionValue')} />
          <Fact label={t('access.effect')} value={t('access.effectValue')} />
          <Fact label={t('access.inheritance')} value={t('access.inheritanceValue')} />
        </div>
        <ul className="mt-4 space-y-3 text-sm text-muted">
          <Bullet>{t('access.prioritySpecific')}</Bullet>
          <Bullet>{t('access.priorityUser')}</Bullet>
          <Bullet>{t('access.priorityDeny')}</Bullet>
          <Bullet>{t('access.priorityGlobal')}</Bullet>
        </ul>
      </GuideSection>

      <GuideSection
        icon={UserCog}
        title={t('access.managerTitle')}
        description={t('access.managerDescription')}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <InstructionCard number="A" title={t('access.localManagerTitle')} badge={t('recommended')}>
            <p>{t('access.localManagerText')}</p>
            <ul className="space-y-2">
              <Bullet>{t('access.localManagerAdd')}</Bullet>
              <Bullet>{t('access.localManagerRemove')}</Bullet>
              <Bullet>{t('access.localManagerLimits')}</Bullet>
            </ul>
          </InstructionCard>
          <InstructionCard number="B" title={t('access.globalManagerTitle')}>
            <p>{t('access.globalManagerText')}</p>
            <ul className="space-y-2">
              <Bullet>{t('access.globalManagerAll')}</Bullet>
              <Bullet>{t('access.globalManagerRoles')}</Bullet>
              <Bullet>{t('access.globalManagerUse')}</Bullet>
            </ul>
          </InstructionCard>
        </div>
        <Callout warning>{t('access.managerWarning')}</Callout>
      </GuideSection>

      <GuideSection
        icon={BookOpen}
        title={t('access.exampleTitle')}
        description={t('access.exampleDescription')}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <InstructionCard number="1" title={t('access.exampleRoleTitle')}>
            <p>{t('access.exampleRoleText')}</p>
          </InstructionCard>
          <InstructionCard number="2" title={t('access.exampleGroupTitle')}>
            <p>{t('access.exampleGroupText')}</p>
          </InstructionCard>
          <InstructionCard number="3" title={t('access.exampleSpaceTitle')}>
            <p>{t('access.exampleSpaceText')}</p>
          </InstructionCard>
        </div>
        <Callout>{t('access.exampleResult')}</Callout>
      </GuideSection>

      <GuideSection
        icon={Activity}
        title={t('access.liveTitle')}
        description={t('access.liveDescription')}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <InfoTile icon={Network} title={t('access.liveSocketTitle')}>
            {t('access.liveSocketText')}
          </InfoTile>
          <InfoTile icon={ShieldCheck} title={t('access.previewTitle')}>
            {t('access.previewText')}
          </InfoTile>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link href="/settings/roles" className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
            {t('access.openRoles')}
          </Link>
          <Link href="/settings/groups" className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
            {t('access.openGroups')}
          </Link>
          <Link href="/settings/spaces" className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2">
            {t('access.openSpaces')}
          </Link>
        </div>
      </GuideSection>
    </div>
  );
}

function McpGuide({ endpoint }: { endpoint: string }) {
  const t = useTranslations('settings.setup');
  const codexOAuth = `codex mcp add ad-wiki --url ${endpoint}\ncodex mcp login ad-wiki --scopes mcp:read`;
  const codexToken = `$env:AD_WIKI_MCP_TOKEN = "ad_wiki_mcp_..."\ncodex mcp remove ad-wiki\ncodex mcp add ad-wiki --url ${endpoint} --bearer-token-env-var AD_WIKI_MCP_TOKEN\ncodex`;
  const claudeCode = `claude mcp add --transport http ad-wiki ${endpoint}\nclaude mcp get ad-wiki\nclaude\n# Danach in Claude Code: /mcp → Authenticate`;

  return (
    <div id="setup-panel-mcp" role="tabpanel" aria-labelledby="setup-tab-mcp" className="flex flex-col gap-5">
      <GuideSection icon={Server} title={t('mcp.endpointTitle')} description={t('mcp.endpointDescription')}>
        <CodeBlock label={t('mcp.serverEndpoint')} value={endpoint} />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Fact label={t('mcp.transport')} value="Streamable HTTP" />
          <Fact label={t('mcp.auth')} value="OAuth 2.1 / Bearer Token" />
          <Fact label={t('mcp.scopes')} value="mcp:read · mcp:write" />
        </div>
      </GuideSection>

      <GuideSection icon={Terminal} title={t('mcp.clientsTitle')} description={t('mcp.clientsDescription')}>
        <div className="grid gap-4 xl:grid-cols-2">
          <InstructionCard number="1" title={t('mcp.codexOauthTitle')} badge={t('recommended')}>
            <p>{t('mcp.codexOauthText')}</p>
            <CodeBlock label="PowerShell" value={codexOAuth} />
            <Callout>{t('mcp.writeScopeHint')}</Callout>
          </InstructionCard>
          <InstructionCard number="2" title={t('mcp.codexTokenTitle')}>
            <p>{t('mcp.codexTokenText')}</p>
            <CodeBlock label="PowerShell" value={codexToken} />
            <Callout warning>{t('mcp.tokenWarning')}</Callout>
          </InstructionCard>
          <InstructionCard number="3" title={t('mcp.claudeCodeTitle')}>
            <p>{t('mcp.claudeCodeText')}</p>
            <CodeBlock label="Terminal" value={claudeCode} />
            <Callout warning>{t('mcp.claudeCodeTlsHint')}</Callout>
          </InstructionCard>
          <InstructionCard number="4" title={t('mcp.claudeDesktopTitle')}>
            <p>{t('mcp.claudeDesktopText')}</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <Bullet>{t('mcp.claudeDesktopPublic')}</Bullet>
              <Bullet>{t('mcp.claudeDesktopTls')}</Bullet>
              <Bullet>{t('mcp.claudeDesktopLocal')}</Bullet>
            </ul>
          </InstructionCard>
        </div>
      </GuideSection>

      <GuideSection icon={ShieldCheck} title={t('mcp.securityTitle')} description={t('mcp.securityDescription')}>
        <div className="grid gap-3 md:grid-cols-2">
          <InfoTile icon={LockKeyhole} title={t('mcp.aclTitle')}>{t('mcp.aclText')}</InfoTile>
          <InfoTile icon={Cloud} title={t('mcp.visibilityTitle')}>{t('mcp.visibilityText')}</InfoTile>
          <InfoTile icon={KeyRound} title={t('mcp.tokenTitle')}>{t('mcp.tokenText')}</InfoTile>
          <InfoTile icon={Clipboard} title={t('mcp.draftsTitle')}>{t('mcp.draftsText')}</InfoTile>
        </div>
        <h4 className="mb-2 mt-5 text-sm font-semibold text-foreground">{t('mcp.rolePermissionsTitle')}</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          <Fact label="mcp:read" value={t('mcp.roleRead')} />
          <Fact label="mcp:create" value={t('mcp.roleCreate')} />
          <Fact label="mcp:delete" value={t('mcp.roleDelete')} />
        </div>
      </GuideSection>

      <GuideSection icon={Wrench} title={t('mcp.toolsTitle')} description={t('mcp.toolsDescription')}>
        <div className="space-y-5">
          {MCP_TOOL_GROUPS.map((group) => (
            <div key={group.key}>
              <h4 className="mb-2 text-sm font-semibold text-foreground">{t(`mcp.groups.${group.key}`)}</h4>
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="hidden grid-cols-[minmax(180px,0.8fr)_minmax(210px,0.9fr)_1.4fr] gap-3 bg-background px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
                  <span>{t('mcp.tool')}</span><span>{t('mcp.permission')}</span><span>{t('mcp.purpose')}</span>
                </div>
                {group.tools.map(([name, permission]) => (
                  <div key={name} className="grid gap-2 border-t border-border px-4 py-3 first:border-t-0 md:grid-cols-[minmax(180px,0.8fr)_minmax(210px,0.9fr)_1.4fr] md:gap-3">
                    <code className="break-all text-sm font-semibold text-accent-700">{name}</code>
                    <div><span className="md:hidden text-xs font-semibold text-muted">{t('mcp.permission')}: </span><code className="text-xs text-foreground">{permission}</code></div>
                    <p className="text-sm leading-5 text-muted">{t(`mcp.toolDescriptions.${name}`)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </GuideSection>

      <div className="grid gap-5 xl:grid-cols-2">
        <GuideSection icon={Database} title={t('mcp.resourcesTitle')} description={t('mcp.resourcesDescription')}>
          <CodeBlock label="MCP Resources" value={'ad-wiki://wiki/{slug}\nad-wiki://notes/{id}\nad-wiki://standards/{id}'} />
        </GuideSection>
        <GuideSection icon={AlertTriangle} title={t('mcp.troubleshootingTitle')} description={t('mcp.troubleshootingDescription')}>
          <ul className="space-y-3 text-sm text-muted">
            <Bullet>{t('mcp.troubleshootingAuth')}</Bullet>
            <Bullet>{t('mcp.troubleshootingTls')}</Bullet>
            <Bullet>{t('mcp.troubleshootingTools')}</Bullet>
          </ul>
          <div className="mt-4 space-y-2">
            <CodeBlock label={t('mcp.oauthMetadata')} value={`${endpoint.replace(/\/mcp$/, '')}/.well-known/oauth-protected-resource/mcp\n${endpoint.replace(/\/mcp$/, '')}/.well-known/oauth-authorization-server`} />
          </div>
        </GuideSection>
      </div>
    </div>
  );
}

function IntegrationGuide() {
  const t = useTranslations('settings.setup');
  const devEnv = `MICROSOFT_TENANT_ID=<Directory-Tenant-ID>\nMICROSOFT_CLIENT_ID=<Application-Client-ID>\nMICROSOFT_CLIENT_SECRET=<Client-Secret-Wert>\nMICROSOFT_REDIRECT_URI=${DEV_CALLBACK}\nINTEGRATION_ENCRYPTION_KEY=<32-zufällige-Bytes-als-Base64>`;
  const prodEnv = `MICROSOFT_TENANT_ID=<Directory-Tenant-ID>\nMICROSOFT_CLIENT_ID=<Application-Client-ID>\nMICROSOFT_REDIRECT_URI=${PROD_CALLBACK}\nAD_WIKI_MICROSOFT_CLIENT_SECRET=<Client-Secret-Wert>\nAD_WIKI_INTEGRATION_ENCRYPTION_KEY=<32-zufällige-Bytes-als-Base64>`;
  const keyCommand = `$bytes = [byte[]]::new(32)\n$rng = [Security.Cryptography.RandomNumberGenerator]::Create()\n$rng.GetBytes($bytes)\n$rng.Dispose()\n[Convert]::ToBase64String($bytes)`;

  return (
    <div id="setup-panel-integrations" role="tabpanel" aria-labelledby="setup-tab-integrations" className="flex flex-col gap-5">
      <GuideSection icon={Cloud} title={t('integrations.entraTitle')} description={t('integrations.entraDescription')}>
        <ol className="grid gap-3 lg:grid-cols-2">
          {[1, 2, 3, 4].map((step) => (
            <li key={step} className="flex gap-3 rounded-xl border border-border bg-background p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-600 text-xs font-bold text-white">{step}</span>
              <div><h4 className="text-sm font-semibold text-foreground">{t(`integrations.steps.${step}.title`)}</h4><p className="mt-1 text-sm leading-5 text-muted">{t(`integrations.steps.${step}.text`)}</p></div>
            </li>
          ))}
        </ol>
      </GuideSection>

      <GuideSection icon={Link2} title={t('integrations.redirectTitle')} description={t('integrations.redirectDescription')}>
        <div className="grid gap-4 xl:grid-cols-2">
          <CodeBlock label={t('integrations.development')} value={DEV_CALLBACK} />
          <CodeBlock label={t('integrations.production')} value={PROD_CALLBACK} />
        </div>
        <Callout warning>{t('integrations.redirectWarning')}</Callout>
      </GuideSection>

      <GuideSection icon={ShieldCheck} title={t('integrations.graphTitle')} description={t('integrations.graphDescription')}>
        <Callout>{t('integrations.graphSummary')}</Callout>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <PermissionTile
            icon={ListChecks}
            badge={t('integrations.graphManualBadge')}
            badgeTone="action"
            meta={t('integrations.graphDelegatedLabel')}
            title="Tasks.ReadWrite"
          >
            {t('integrations.tasksPermission')}
          </PermissionTile>
          <PermissionTile
            icon={LockKeyhole}
            badge={t('integrations.graphAutoBadge')}
            badgeTone="auto"
            meta={t('integrations.graphScopesLabel')}
            title="openid · profile · offline_access"
          >
            {t('integrations.openidScopes')}
          </PermissionTile>
        </div>
        <Callout>{t('integrations.consentHint')}</Callout>
      </GuideSection>

      <GuideSection icon={Code2} title={t('integrations.environmentTitle')} description={t('integrations.environmentDescription')}>
        <div className="grid gap-4 xl:grid-cols-2">
          <CodeBlock label={t('integrations.developmentEnv')} value={devEnv} />
          <CodeBlock label={t('integrations.productionEnv')} value={prodEnv} />
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <InstructionCard number="A" title={t('integrations.secretTitle')}>
            <p>{t('integrations.secretText')}</p>
          </InstructionCard>
          <InstructionCard number="B" title={t('integrations.encryptionTitle')}>
            <p>{t('integrations.encryptionText')}</p>
            <CodeBlock label="PowerShell" value={keyCommand} />
          </InstructionCard>
        </div>
      </GuideSection>

      <GuideSection icon={LockKeyhole} title={t('integrations.rightsTitle')} description={t('integrations.rightsDescription')}>
        <div className="overflow-hidden rounded-xl border border-border">
          {INTEGRATION_RIGHTS.map(([key, permission]) => (
            <div key={key} className="grid gap-1 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[190px_1fr] sm:gap-4">
              <code className="text-sm font-semibold text-accent-700">{permission}</code>
              <p className="text-sm text-muted">{t(`integrations.rights.${key}`)}</p>
            </div>
          ))}
        </div>
      </GuideSection>

      <div className="grid gap-5 xl:grid-cols-2">
        <GuideSection icon={Plug} title={t('integrations.workflowTitle')} description={t('integrations.workflowDescription')}>
          <ol className="space-y-3">
            {[1, 2, 3, 4].map((step) => <WorkflowStep key={step} number={step}>{t(`integrations.workflow.${step}`)}</WorkflowStep>)}
          </ol>
        </GuideSection>
        <GuideSection icon={AlertTriangle} title={t('integrations.troubleshootingTitle')} description={t('integrations.troubleshootingDescription')}>
          <ul className="space-y-3 text-sm text-muted">
            <Bullet>{t('integrations.errorRedirect')}</Bullet>
            <Bullet>{t('integrations.errorConfig')}</Bullet>
            <Bullet>{t('integrations.errorSecret')}</Bullet>
            <Bullet>{t('integrations.errorRebuild')}</Bullet>
          </ul>
          <div className="mt-4"><CodeBlock label={t('integrations.rebuild')} value="npm run docker:rebuild" /></div>
        </GuideSection>
      </div>
    </div>
  );
}

function MonitoringGuide() {
  const t = useTranslations('settings.setup');
  const endpoints = `${MONITORING_BASE_URL}/api/v1/health/live\n${MONITORING_BASE_URL}/api/v1/health/ready\n${MONITORING_BASE_URL}/api/v1/health/metrics`;
  const tokenEnvironment = `AD_WIKI_MONITORING_TOKEN=<${t('monitoring.tokenPlaceholder')}>`;
  const prometheusConfig = `scrape_configs:
  - job_name: ad-wiki-api
    scheme: https
    metrics_path: /api/v1/health/metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/ad-wiki-monitoring-token
    static_configs:
      - targets: ["wiki.example.com"]`;
  const zabbixConfig = `{$AD_WIKI_URL}=https://wiki.example.com
{$AD_WIKI_MONITORING_TOKEN}=<Secret text>

HTTP agent: {$AD_WIKI_URL}/api/v1/health/metrics
Header: Authorization: Bearer {$AD_WIKI_MONITORING_TOKEN}`;
  const packagePaths = `monitoring/prometheus/ad-wiki-scrape.example.yml
monitoring/prometheus/rules/ad-wiki-alerts.yml
monitoring/grafana/ad-wiki-overview.json
monitoring/zabbix/README.md`;
  const blackboxConfig = `modules:
  ad_wiki_https_pki:
    prober: http
    http:
      tls_config:
        ca_file: /etc/blackbox-exporter/pki/ad-wiki-root-ca.pem
        server_name: wiki.example.com
        insecure_skip_verify: false`;

  return (
    <div id="setup-panel-monitoring" role="tabpanel" aria-labelledby="setup-tab-monitoring" className="flex flex-col gap-5">
      <GuideSection icon={Activity} title={t('monitoring.overviewTitle')} description={t('monitoring.overviewDescription')}>
        <div className="grid gap-3 md:grid-cols-2">
          <InfoTile icon={Server} title={t('monitoring.appTitle')}>{t('monitoring.appText')}</InfoTile>
          <InfoTile icon={Wrench} title={t('monitoring.operatorTitle')}>{t('monitoring.operatorText')}</InfoTile>
        </div>
        <Callout>{t('monitoring.stackHint')}</Callout>
      </GuideSection>

      <GuideSection icon={Network} title={t('monitoring.endpointsTitle')} description={t('monitoring.endpointsDescription')}>
        <CodeBlock label={t('monitoring.endpointLabel')} value={endpoints} />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Fact label={t('monitoring.liveness')} value={t('monitoring.publicEndpoint')} />
          <Fact label={t('monitoring.readiness')} value={t('monitoring.publicEndpoint')} />
          <Fact label={t('monitoring.metrics')} value="Bearer Token" />
        </div>
      </GuideSection>

      <GuideSection icon={KeyRound} title={t('monitoring.tokenTitle')} description={t('monitoring.tokenDescription')}>
        <CodeBlock label=".env.production" value={tokenEnvironment} />
        <Callout warning>{t('monitoring.tokenWarning')}</Callout>
      </GuideSection>

      <GuideSection icon={ChartNoAxesCombined} title={t('monitoring.platformTitle')} description={t('monitoring.platformDescription')}>
        <div className="grid gap-4 xl:grid-cols-2">
          <InstructionCard number="P" title={t('monitoring.prometheusTitle')}>
            <p>{t('monitoring.prometheusText')}</p>
            <CodeBlock label="prometheus.yml" value={prometheusConfig} />
          </InstructionCard>
          <InstructionCard number="Z" title={t('monitoring.zabbixTitle')}>
            <p>{t('monitoring.zabbixText')}</p>
            <CodeBlock label={t('monitoring.zabbixLabel')} value={zabbixConfig} />
          </InstructionCard>
        </div>
        <div className="mt-4">
          <CodeBlock label={t('monitoring.packageLabel')} value={packagePaths} />
        </div>
        <Callout>{t('monitoring.packageHint')}</Callout>
      </GuideSection>

      <GuideSection icon={Activity} title={t('monitoring.metricsTitle')} description={t('monitoring.metricsDescription')}>
        <div className="grid gap-3 lg:grid-cols-2">
          {MONITORING_METRIC_GROUPS.map((group) => (
            <article key={group.key} className="rounded-xl border border-border bg-background p-4">
              <h4 className="text-sm font-semibold text-foreground">{t(`monitoring.metricGroups.${group.key}.title`)}</h4>
              <p className="mt-1 text-sm leading-5 text-muted">{t(`monitoring.metricGroups.${group.key}.text`)}</p>
              <ul className="mt-3 space-y-1.5">
                {group.metrics.map((metric) => (
                  <li key={metric}><code className="break-all text-xs font-semibold text-accent-700">{metric}</code></li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </GuideSection>

      <GuideSection icon={AlertTriangle} title={t('monitoring.thresholdsTitle')} description={t('monitoring.thresholdsDescription')}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={t('monitoring.filesystem')} value={t('monitoring.filesystemValue')} />
          <Fact label={t('monitoring.certificate')} value={t('monitoring.certificateValue')} />
          <Fact label={t('monitoring.unreachable')} value={t('monitoring.unreachableValue')} />
          <Fact label={t('monitoring.retention')} value={t('monitoring.retentionValue')} />
        </div>
        <Callout warning>{t('monitoring.thresholdHint')}</Callout>
      </GuideSection>

      <GuideSection icon={ShieldCheck} title={t('monitoring.tlsTitle')} description={t('monitoring.tlsDescription')}>
        <CodeBlock label="blackbox.yml" value={blackboxConfig} />
        <Callout>{t('monitoring.tlsHint')}</Callout>
      </GuideSection>

      <GuideSection icon={ListChecks} title={t('monitoring.acceptanceTitle')} description={t('monitoring.acceptanceDescription')}>
        <ol className="space-y-3">
          {[1, 2, 3, 4, 5].map((step) => (
            <WorkflowStep key={step} number={step} showConnector={false}>{t(`monitoring.acceptance.${step}`)}</WorkflowStep>
          ))}
        </ol>
        <div className="mt-4">
          <Link href="/settings/system-info" className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2">
            <Activity className="h-4 w-4" aria-hidden="true" />
            {t('monitoring.openSystemInfo')}
          </Link>
        </div>
      </GuideSection>
    </div>
  );
}

function BackupGuide() {
  const t = useTranslations('settings.setup');
  const productionEnvironment = `BACKUP_LOCAL_PATH=./backups\nBACKUP_NETWORK_PATH=/mnt/ad-wiki-backups\nBACKUP_UID=1000\nBACKUP_GID=1000\nBACKUP_POLL_INTERVAL_MS=2000\nAD_WIKI_BACKUP_ENCRYPTION_KEY=<32-random-bytes-as-Base64>`;
  const keyCommands = `# Linux / macOS\nopenssl rand -base64 32\n\n# PowerShell\n$bytes = [byte[]]::new(32)\n$rng = [Security.Cryptography.RandomNumberGenerator]::Create()\n$rng.GetBytes($bytes)\n$rng.Dispose()\n[Convert]::ToBase64String($bytes)`;
  const stopCommand = 'docker compose --env-file .env.production -f docker-compose.prod.yml stop nginx web api backup-worker';
  const dryRunCommand = 'docker compose --env-file .env.production -f docker-compose.prod.yml --profile operations run --rm backup-restore restore --mount local --backup <relative-backup-path> --dry-run';
  const restoreCommand = 'docker compose --env-file .env.production -f docker-compose.prod.yml --profile operations run --rm backup-restore restore --mount local --backup <relative-backup-path> --confirm <backup-id>';
  const startCommand = 'docker compose --env-file .env.production -f docker-compose.prod.yml up -d api backup-worker web nginx\ndocker compose --env-file .env.production -f docker-compose.prod.yml ps';

  return (
    <div id="setup-panel-backups" role="tabpanel" aria-labelledby="setup-tab-backups" className="flex flex-col gap-5">
      <GuideSection icon={DatabaseBackup} title={t('backups.overviewTitle')} description={t('backups.overviewDescription')}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={t('backups.scopeDatabase')} value="PostgreSQL 18 · Custom Dump" />
          <Fact label={t('backups.scopeUploads')} value="Uploads · TAR/GZIP" />
          <Fact label={t('backups.scopeIntegrity')} value="SHA-256 · Manifest" />
          <Fact label={t('backups.scopeCoordination')} value="Redis Lock · Write Barrier" />
        </div>
        <Callout warning>{t('backups.scopeWarning')}</Callout>
        <div className="mt-4">
          <Link href="/settings/backups" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2">
            <DatabaseBackup className="h-4 w-4" />{t('backups.openManagement')}
          </Link>
        </div>
      </GuideSection>

      <GuideSection icon={KeyRound} title={t('backups.foundationTitle')} description={t('backups.foundationDescription')}>
        <div className="grid gap-4 xl:grid-cols-2">
          <CodeBlock label=".env.production" value={productionEnvironment} />
          <CodeBlock label={t('backups.generateKey')} value={keyCommands} />
        </div>
        <Callout warning>{t('backups.keyWarning')}</Callout>
        <ul className="mt-4 space-y-3 text-sm text-muted">
          <Bullet>{t('backups.foundationMount')}</Bullet>
          <Bullet>{t('backups.foundationWorker')}</Bullet>
          <Bullet>{t('backups.foundationSecrets')}</Bullet>
        </ul>
      </GuideSection>

      <GuideSection icon={FolderSync} title={t('backups.destinationsTitle')} description={t('backups.destinationsDescription')}>
        <div className="grid gap-4 xl:grid-cols-3">
          <InstructionCard number="1" title={t('backups.mountStepHostTitle')}>
            <p>{t('backups.mountStepHostText')}</p>
          </InstructionCard>
          <InstructionCard number="2" title={t('backups.mountStepContainerTitle')}>
            <p>{t('backups.mountStepContainerText')}</p>
            <CodeBlock label="Terminal" value="npm run docker:rebuild" />
          </InstructionCard>
          <InstructionCard number="3" title={t('backups.mountStepUiTitle')}>
            <p>{t('backups.mountStepUiText')}</p>
          </InstructionCard>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <InfoTile icon={HardDrive} title={t('backups.destinationMountTitle')}>{t('backups.destinationMountText')}</InfoTile>
          <InfoTile icon={Server} title={t('backups.destinationSftpTitle')}>{t('backups.destinationSftpText')}</InfoTile>
          <InfoTile icon={Cloud} title={t('backups.destinationS3Title')}>{t('backups.destinationS3Text')}</InfoTile>
          <InfoTile icon={ShieldCheck} title={t('backups.destinationTestTitle')}>{t('backups.destinationTestText')}</InfoTile>
        </div>
        <Callout>{t('backups.offsiteRecommendation')}</Callout>
      </GuideSection>

      <GuideSection icon={TimerReset} title={t('backups.scheduleTitle')} description={t('backups.scheduleDescription')}>
        <div className="grid gap-4 xl:grid-cols-3">
          <InstructionCard number="1" title={t('backups.scheduleDestinationTitle')}>
            <p>{t('backups.scheduleDestinationText')}</p>
          </InstructionCard>
          <InstructionCard number="2" title={t('backups.schedulePlanTitle')}>
            <p>{t('backups.schedulePlanText')}</p>
          </InstructionCard>
          <InstructionCard number="3" title={t('backups.scheduleVerifyTitle')}>
            <p>{t('backups.scheduleVerifyText')}</p>
          </InstructionCard>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Fact label={t('backups.retentionDaily')} value={t('backups.retentionDailyValue')} />
          <Fact label={t('backups.retentionWeekly')} value={t('backups.retentionWeeklyValue')} />
          <Fact label={t('backups.retentionMonthly')} value={t('backups.retentionMonthlyValue')} />
        </div>
        <Callout>{t('backups.scheduleHint')}</Callout>
      </GuideSection>

      <GuideSection icon={ArchiveRestore} title={t('backups.restoreTitle')} description={t('backups.restoreDescription')}>
        <div className="grid gap-4 xl:grid-cols-2">
          <InstructionCard number="1" title={t('backups.restorePrepareTitle')}>
            <p>{t('backups.restorePrepareText')}</p>
          </InstructionCard>
          <InstructionCard number="2" title={t('backups.restoreDryRunTitle')} badge={t('recommended')}>
            <p>{t('backups.restoreDryRunText')}</p>
            <CodeBlock label="Terminal" value={dryRunCommand} />
          </InstructionCard>
          <InstructionCard number="3" title={t('backups.restoreStopTitle')}>
            <p>{t('backups.restoreStopText')}</p>
            <CodeBlock label="Terminal" value={stopCommand} />
          </InstructionCard>
          <InstructionCard number="4" title={t('backups.restoreExecuteTitle')}>
            <p>{t('backups.restoreExecuteText')}</p>
            <CodeBlock label="Terminal" value={restoreCommand} />
          </InstructionCard>
          <InstructionCard number="5" title={t('backups.restoreStartTitle')}>
            <p>{t('backups.restoreStartText')}</p>
            <CodeBlock label="Terminal" value={startCommand} />
          </InstructionCard>
          <InstructionCard number="6" title={t('backups.restoreValidateTitle')}>
            <p>{t('backups.restoreValidateText')}</p>
          </InstructionCard>
        </div>
        <Callout warning>{t('backups.restoreWarning')}</Callout>
      </GuideSection>

      <GuideSection icon={ShieldCheck} title={t('backups.rightsTitle')} description={t('backups.rightsDescription')}>
        <div className="overflow-hidden rounded-xl border border-border">
          {BACKUP_RIGHTS.map(([key, permission]) => (
            <div key={key} className="grid gap-1 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[190px_1fr] sm:gap-4">
              <code className="text-sm font-semibold text-accent-700">{permission}</code>
              <p className="text-sm text-muted">{t(`backups.rights.${key}`)}</p>
            </div>
          ))}
        </div>
      </GuideSection>

      <div className="grid gap-5 xl:grid-cols-2">
        <GuideSection icon={Activity} title={t('backups.monitoringTitle')} description={t('backups.monitoringDescription')}>
          <ul className="space-y-3 text-sm text-muted">
            <Bullet>{t('backups.monitoringFreshness')}</Bullet>
            <Bullet>{t('backups.monitoringFailure')}</Bullet>
            <Bullet>{t('backups.monitoringCapacity')}</Bullet>
            <Bullet>{t('backups.monitoringDrill')}</Bullet>
          </ul>
          <div className="mt-4"><CodeBlock label={t('backups.metricsLabel')} value={'ad_wiki_backup_last_success_age_seconds\nad_wiki_backup_last_duration_seconds\nad_wiki_backup_last_size_bytes\nad_wiki_backup_failures_total\nad_wiki_backup_active_jobs'} /></div>
        </GuideSection>
        <GuideSection icon={AlertTriangle} title={t('backups.troubleshootingTitle')} description={t('backups.troubleshootingDescription')}>
          <ul className="space-y-3 text-sm text-muted">
            <Bullet>{t('backups.errorDestination')}</Bullet>
            <Bullet>{t('backups.errorSpace')}</Bullet>
            <Bullet>{t('backups.errorIntegrity')}</Bullet>
            <Bullet>{t('backups.errorBarrier')}</Bullet>
            <Bullet>{t('backups.errorKey')}</Bullet>
          </ul>
        </GuideSection>
      </div>
    </div>
  );
}

function TabButton({ tab, active, icon: Icon, onClick, children }: { tab: GuideTab; active: boolean; icon: GuideIcon; onClick: () => void; children: ReactNode }) {
  return <button id={`setup-tab-${tab}`} type="button" role="tab" aria-controls={`setup-panel-${tab}`} aria-selected={active} onClick={onClick} className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1 ${active ? 'bg-accent-50 text-accent-700 shadow-sm' : 'text-muted hover:bg-background hover:text-foreground'}`}><Icon className="h-4 w-4" aria-hidden="true" />{children}</button>;
}

function GuideSection({ icon: Icon, title, description, children }: { icon: GuideIcon; title: string; description?: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5"><div className="mb-4 flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700"><Icon className="h-4.5 w-4.5" /></div><div><h3 className="font-semibold text-foreground">{title}</h3>{description && <p className="mt-1 text-sm leading-6 text-muted">{description}</p>}</div></div>{children}</section>;
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  const t = useTranslations('settings.setup');
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return <div className="overflow-hidden rounded-xl border border-border bg-slate-950"><div className="flex items-center justify-between border-b border-white/10 px-3 py-2"><span className="text-xs font-medium text-slate-300">{label}</span><button type="button" onClick={() => void copy()} className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white" aria-label={t('copy')} >{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? t('copied') : t('copy')}</button></div><pre className="overflow-x-auto whitespace-pre-wrap break-words p-3 text-xs leading-5 text-slate-100"><code>{value}</code></pre></div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-background p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p><p className="mt-1 break-words text-sm font-semibold text-foreground">{value}</p></div>;
}

function InstructionCard({ number, title, badge, children }: { number: string; title: string; badge?: string; children: ReactNode }) {
  return <article className="rounded-xl border border-border bg-background p-4"><div className="mb-3 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-600 text-xs font-bold text-white">{number}</span><h4 className="font-semibold text-foreground">{title}</h4>{badge && <span className="ml-auto rounded-full bg-success-50 px-2 py-1 text-[11px] font-semibold text-success-600">{badge}</span>}</div><div className="space-y-3 text-sm leading-6 text-muted">{children}</div></article>;
}

function InfoTile({ icon: Icon, title, children }: { icon: GuideIcon; title: string; children: ReactNode }) {
  return <div className="flex gap-3 rounded-xl border border-border bg-background p-4"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-700" /><div><h4 className="text-sm font-semibold text-foreground">{title}</h4><p className="mt-1 text-sm leading-5 text-muted">{children}</p></div></div>;
}

function PermissionTile({
  icon: Icon,
  badge,
  badgeTone,
  meta,
  title,
  children,
}: {
  icon: GuideIcon;
  badge: string;
  badgeTone: 'action' | 'auto';
  meta: string;
  title: string;
  children: ReactNode;
}) {
  const badgeClass = badgeTone === 'action' ? 'bg-accent-50 text-accent-700' : 'bg-background text-muted';
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeClass}`}>{badge}</span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{meta}</span>
      </div>
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-700" />
        <div>
          <code className="break-all text-sm font-semibold text-foreground">{title}</code>
          <p className="mt-1 text-sm leading-5 text-muted">{children}</p>
        </div>
      </div>
    </div>
  );
}

function Callout({ warning = false, children }: { warning?: boolean; children: ReactNode }) {
  return <div className={`mt-3 flex gap-2 rounded-lg px-3 py-2.5 text-sm leading-5 ${warning ? 'bg-warning-50 text-warning-700' : 'bg-accent-50 text-accent-700'}`}>{warning ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />}<span>{children}</span></div>;
}

function Bullet({ children }: { children: ReactNode }) {
  return <li className="flex gap-2"><ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" /><span>{children}</span></li>;
}

function WorkflowStep({ number, showConnector = true, children }: { number: number; showConnector?: boolean; children: ReactNode }) {
  return <li className="flex items-center gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-bold text-accent-700">{number}</span><span className="text-sm text-muted">{children}</span>{showConnector && number < 4 && <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted" aria-hidden="true" />}</li>;
}
