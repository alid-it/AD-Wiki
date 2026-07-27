import { Module } from "@nestjs/common";
import { KnowledgeAccessService } from "@/modules/knowledge/knowledge-access.service";
import { KnowledgeWriteService } from "@/modules/knowledge/knowledge-write.service";
import { KnowledgeIntelligenceService } from "@/modules/knowledge/knowledge-intelligence.service";
import { StandardsEvaluationService } from "@/modules/knowledge/standards-evaluation.service";
import { NotesModule } from "@/modules/notes/notes.module";
import { PagesModule } from "@/modules/pages/pages.module";
import { StandardsModule } from "@/modules/standards/standards.module";
import { ResourceAclsModule } from "@/modules/resource-acls/resource-acls.module";

/** Gemeinsame, transportneutrale Zugriffsschicht für freigegebenes Wissen. */
@Module({
  imports: [PagesModule, NotesModule, StandardsModule, ResourceAclsModule],
  providers: [
    KnowledgeAccessService,
    KnowledgeWriteService,
    KnowledgeIntelligenceService,
    StandardsEvaluationService,
  ],
  exports: [
    KnowledgeAccessService,
    KnowledgeWriteService,
    KnowledgeIntelligenceService,
    StandardsEvaluationService,
  ],
})
export class KnowledgeModule {}
