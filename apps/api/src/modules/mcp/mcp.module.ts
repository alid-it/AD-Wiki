import { Module } from "@nestjs/common";
import { AuthModule } from "@/modules/auth/auth.module";
import { KnowledgeModule } from "@/modules/knowledge/knowledge.module";
import { McpController } from "@/modules/mcp/mcp.controller";
import { McpServerService } from "@/modules/mcp/mcp-server.service";
import { McpTokenController } from "@/modules/mcp/mcp-token.controller";
import { McpTokenService } from "@/modules/mcp/mcp-token.service";
import {
  McpOAuthApprovalController,
  McpOAuthMetadataController,
  McpOAuthPublicController,
} from "@/modules/mcp/mcp-oauth.controller";
import { McpOAuthService } from "@/modules/mcp/mcp-oauth.service";
import { McpRateLimitService } from "@/modules/mcp/mcp-rate-limit.service";
import { HealthModule } from "@/health/health.module";

@Module({
  imports: [AuthModule, KnowledgeModule, HealthModule],
  controllers: [McpController, McpTokenController, McpOAuthMetadataController, McpOAuthPublicController, McpOAuthApprovalController],
  providers: [McpTokenService, McpOAuthService, McpRateLimitService, McpServerService],
  exports: [McpTokenService],
})
export class McpModule {}
