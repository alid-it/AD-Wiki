import { Module } from "@nestjs/common";
import { UsersController } from "@/modules/users/users.controller";
import { UsersService } from "@/modules/users/users.service";
import { AuthModule } from "@/modules/auth/auth.module";

/** Modul für Benutzerprofile. */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
