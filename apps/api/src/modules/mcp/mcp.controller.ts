import { All, Controller, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { McpServerService } from "@/modules/mcp/mcp-server.service";

/** Streamable-HTTP-Endpunkt unter /mcp (bewusst ausserhalb von /api/v1). */
@Controller("mcp")
export class McpController {
  constructor(private readonly server: McpServerService) {}

  @All()
  handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.server.handle(req, res);
  }
}
