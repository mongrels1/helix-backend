import {
  Controller,
  Get,
  Param,
  Post,
  Put,
  Body,
  StreamableFile,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { LessonPlanService } from './lesson-plan.service';
import { GeneratePlanDto } from './dto/generate-plan.dto';
import { LessonPlanAllowanceService } from './lesson-plan.allowance';
import { LessonPlanContextService } from './lesson-plan.context';
import { SaveContextDto } from './dto/save-context.dto';

type AuthenticatedUser = { userId: string; role: Role };

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
}

@Controller('api/v1/lesson-plan')
@Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
export class LessonPlanController {
  constructor(
    private readonly service: LessonPlanService,
    private readonly allowance: LessonPlanAllowanceService,
    private readonly context: LessonPlanContextService,
  ) {}

  /** The teacher's saved context sheet, or null if they have never saved one. */
  @Get('context')
  async getContext(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.context.get(user.userId) };
  }

  @Put('context')
  async saveContext(@Body() dto: SaveContextDto, @CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.context.save(user.userId, dto) };
  }

  @Post('jobs')
  createJob(
    @CurrentUser() user: AuthenticatedUser,
  ): { success: true; data: { jobId: string } } {
    return { success: true, data: this.service.createJob(user.userId) };
  }

  @Post('jobs/:id/template')
  @UseInterceptors(FileInterceptor('file'))
  async uploadTemplate(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException('no template file provided');
    const fieldMap = await this.service.setTemplate(id, user.userId, file);
    return { success: true, data: { fieldMap } };
  }

  @Post('jobs/:id/resources')
  @UseInterceptors(FilesInterceptor('files', 25))
  async uploadResources(
    @Param('id') id: string,
    @UploadedFiles() files: MulterFile[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!files?.length) throw new BadRequestException('no resource files provided');
    const resources = await this.service.addResources(id, user.userId, files);
    return { success: true, data: { resources } };
  }

  @Post('jobs/:id/generate')
  async generate(
    @Param('id') id: string,
    @Body() dto: GeneratePlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Self-serve teachers have a daily allowance; everyone else passes through.
    await this.allowance.assertCanGenerate(user.userId);
    const data = await this.service.generate(id, user.userId, dto);
    // Charged only once a plan exists. A failure to count must never cost the
    // teacher the plan they just waited for.
    await this.allowance.record(user.userId).catch(() => undefined);
    return { success: true, data };
  }

  @Get('jobs/:id/plan.docx')
  downloadPlan(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const { buffer, filename } = this.service.getDocx(id, user.userId);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
  }
}
