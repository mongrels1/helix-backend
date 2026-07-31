import {
  Controller,
  Get,
  Param,
  Post,
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

type AuthenticatedUser = { userId: string; role: Role };

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
}

@Controller('api/v1/lesson-plan')
@Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
export class LessonPlanController {
  constructor(private readonly service: LessonPlanService) {}

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
    const data = await this.service.generate(id, user.userId, dto);
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
