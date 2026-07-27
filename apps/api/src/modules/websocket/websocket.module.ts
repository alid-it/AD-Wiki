import { Global, Module } from "@nestjs/common";
import { AuthModule } from "@/modules/auth/auth.module";
import { NotificationService } from "@/modules/websocket/notification.service";
import { WebsocketGateway } from "@/modules/websocket/websocket.gateway";

/**
 * Globales WebSocket-Modul. Stellt das Gateway (Verbindungen, Räume, Presence)
 * und den {@link NotificationService} bereit. Durch @Global kann jeder Controller
 * den NotificationService injizieren, ohne dieses Modul explizit zu importieren.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [WebsocketGateway, NotificationService],
  exports: [NotificationService],
})
export class WebsocketModule {}
