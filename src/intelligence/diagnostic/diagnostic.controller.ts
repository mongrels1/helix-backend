import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Public } from '@common/decorators/public.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '@common/guards/optional-jwt-auth.guard';
import { DiagnosticService } from './diagnostic.service';
import { SaveDiagnosticDto } from './dto/save-diagnostic.dto';
import { ClaimDiagnosticDto } from './dto/claim-diagnostic.dto';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

const ANY_USER = [
  Role.STUDENT,
  Role.PARENT,
  Role.TEACHER,
  Role.ORG_ADMIN,
  Role.SUPER_ADMIN,
] as const;

@Controller('api/v1/diagnostic')
export class DiagnosticController {
  constructor(private readonly diagnosticService: DiagnosticService) {}

  /**
   * Save a finished diagnostic. Public so the first run is never gated behind
   * sign-up; OptionalJwtAuthGuard attaches the account when a valid token is present.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('sessions')
  async save(
    @Body() dto: SaveDiagnosticDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ success: true; data: { id: string; saved: boolean; claimToken: string | null } }> {
    const data = await this.diagnosticService.save(dto, user?.userId);
    return { success: true, data };
  }

  /** Attach an anonymous session to the signed-in user (after sign-up). */
  @Roles(...ANY_USER)
  @Post('sessions/:id/claim')
  async claim(
    @Param('id') id: string,
    @Body() dto: ClaimDiagnosticDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: { id: string; saved: boolean } }> {
    const data = await this.diagnosticService.claim(id, dto.claimToken, user.userId);
    return { success: true, data };
  }

  /**
   * Published diagnostic items for the client adaptive engine. Public so the
   * diagnostic loads for anonymous first-runs; empty list ⇒ client uses its
   * in-code bank fallback.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('bank')
  async bank(): Promise<{ success: true; data: unknown[] }> {
    const data = await this.diagnosticService.publishedBank();
    return { success: true, data };
  }

  /** List the signed-in user's saved diagnostics. */
  @Roles(...ANY_USER)
  @Get('sessions/me')
  async mySessions(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: unknown[] }> {
    const data = await this.diagnosticService.listForUser(user.userId);
    return { success: true, data };
  }

  /**
   * Item ids the signed-in student saw in recent sessions, so the adaptive
   * diagnostic can skip them and stop repeating the same questions every run.
   */
  @Roles(...ANY_USER)
  @Get('seen')
  async seen(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: string[] }> {
    const data = await this.diagnosticService.seenItemIds(user.userId);
    return { success: true, data };
  }

  /** Fetch one saved diagnostic (owner only). */
  @Roles(...ANY_USER)
  @Get('sessions/:id')
  async getSession(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: unknown }> {
    const data = await this.diagnosticService.getForUser(id, user.userId);
    return { success: true, data };
  }
}
