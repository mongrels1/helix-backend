import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AssignmentsRepository } from '@modules/assignments/assignments.repository';
import { EventsService } from '../events.service';
import { QUEUES } from '../queues/queue.constants';

@Injectable()
export class AssignmentOverdueScheduler {
  private readonly logger = new Logger(AssignmentOverdueScheduler.name);

  constructor(
    private readonly eventsService: EventsService,
    private readonly assignmentsRepository: AssignmentsRepository,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkOverdueAssignments(): Promise<void> {
    this.logger.log('Checking overdue assignments...');
    const overdue = await this.assignmentsRepository.findOverdue();
    for (const assignment of overdue) {
      await this.eventsService.emit(QUEUES.ASSIGNMENT_OVERDUE, {
        assignmentId: assignment.id,
        classroomId: assignment.classroomId,
      });
    }
    this.logger.log(`Enqueued ${overdue.length} overdue assignment jobs`);
  }
}
