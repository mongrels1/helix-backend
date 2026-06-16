import { Body, Controller, Get, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { CommandDto } from './dto/command.dto';
import { IntentParserService } from './intent-parser/intent-parser.service';
import { ResponseSynthesizerService } from './response-synthesizer/response-synthesizer.service';
import { OrchestratorResponse } from './types/orchestration.types';
import { WorkflowEngineService } from './workflow-engine/workflow-engine.service';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

@Controller('api/v1/orchestration')
@Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
export class OrchestrationController {
  constructor(
    private readonly intentParser: IntentParserService,
    private readonly workflowEngine: WorkflowEngineService,
    private readonly responseSynthesizer: ResponseSynthesizerService,
  ) {}

  @Post('command')
  async command(
    @Body() body: CommandDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: OrchestratorResponse }> {
    const intent = await this.intentParser.parse(body.command, {
      classroomId: body.classroomId,
      assignmentId: body.assignmentId,
    });
    const result = await this.workflowEngine.run(intent, user.userId);
    result.summary = await this.responseSynthesizer.synthesize(result);
    return { success: true, data: { intent, result } };
  }

  @Get('actions')
  async actions(): Promise<{
    success: true;
    data: { actions: { name: string; example: string }[] };
  }> {
    return {
      success: true,
      data: {
        actions: [
          {
            name: 'SEND_NOTIFICATION',
            example: 'Send a reminder to all students in my class',
          },
          {
            name: 'GET_AT_RISK_STUDENTS',
            example: 'Show me at-risk students',
          },
          {
            name: 'GET_OVERDUE_SUBMISSIONS',
            example: 'Which students have not submitted assignment X?',
          },
          {
            name: 'GENERATE_INSIGHT',
            example: 'Generate an insight for this assignment',
          },
        ],
      },
    };
  }
}
