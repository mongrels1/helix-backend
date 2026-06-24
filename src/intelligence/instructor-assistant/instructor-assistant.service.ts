import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InstructorContent, InstructorContentType } from '@prisma/client';
import { AIRouterService } from '../ai-router/ai-router.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerateCourseContentDto } from './dto/generate-course-content.dto';
import { InstructorAssistantRepository } from './instructor-assistant.repository';

@Injectable()
export class InstructorAssistantService {
  constructor(
    private readonly repository: InstructorAssistantRepository,
    private readonly aiRouterService: AIRouterService,
    private readonly prisma: PrismaService,
  ) {}

  async generateCourseContent(
    dto: GenerateCourseContentDto,
  ): Promise<{ lessonContent: string; quizContent: string }> {
    const fallback = this.courseContentFallback(dto);
    const prompt = `You are an expert curriculum designer for a K-12 learning management system.
Create structured JSON content for one course unit.

Topic: ${dto.topic}
Stage: ${dto.stage}
Standard: ${dto.standard ?? 'not provided'}
Unit number: ${dto.unitNumber}

Return ONLY valid JSON. Do not include markdown fences, prose, or comments.
The response must be one JSON object with exactly these keys:
{
  "lessonContent": {
    "type": "lesson",
    "standard": "${dto.standard ?? ''}",
    "learningTargets": ["I can..."],
    "instruction": "Direct instruction text with formulas and one worked example.",
    "guidedProblems": [
      {
        "id": 1,
        "statement": "Problem text",
        "answer": "answer as a string",
        "solution": "Step-by-step solution text",
        "imageDescription": "right triangle"
      }
    ],
    "independentProblems": [
      {
        "id": 4,
        "statement": "Problem text",
        "answer": "answer as a string",
        "solution": "Step-by-step solution text"
      }
    ],
    "exitTicket": ["Reflection question", "Application question"],
    "parentSummary": "Short family-friendly summary."
  },
  "quizContent": [
    {
      "question": "Question text",
      "options": ["A", "B", "C", "D"],
      "answer": 0,
      "solution": "Explanation of the correct answer."
    }
  ]
}

Make 3 guided practice problems, 3 independent practice problems, and 5 multiple-choice quiz questions.
Keep answers short enough for exact string matching.`;

    const raw = await this.generateText(
      prompt,
      1800,
      0.5,
      JSON.stringify({
        lessonContent: JSON.parse(fallback.lessonContent),
        quizContent: JSON.parse(fallback.quizContent),
      }),
    );

    try {
      const parsed = JSON.parse(raw) as {
        lessonContent?: unknown;
        quizContent?: unknown;
      };
      if (!parsed.lessonContent || !Array.isArray(parsed.quizContent)) {
        return fallback;
      }
      return {
        lessonContent:
          typeof parsed.lessonContent === 'string'
            ? parsed.lessonContent
            : JSON.stringify(parsed.lessonContent),
        quizContent:
          typeof parsed.quizContent === 'string'
            ? parsed.quizContent
            : JSON.stringify(parsed.quizContent),
      };
    } catch {
      return fallback;
    }
  }

  async generateInsight(params: {
    classroomId: string;
    assignmentId: string;
    teacherId?: string;
  }): Promise<InstructorContent> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: params.assignmentId },
      select: { title: true, dueAt: true, maxScore: true },
    });
    const prompt = `You are an educational analyst helping a teacher understand why students
may have missed a deadline.
Assignment: "${assignment?.title ?? 'Unknown'}"
Due: ${assignment?.dueAt?.toISOString() ?? 'unknown'}
Max score: ${assignment?.maxScore ?? 'unknown'}
Write 2-3 sentences: likely reasons students missed this deadline,
and one specific actionable suggestion for the teacher.`;
    const content = await this.generateText(
      prompt,
      150,
      0.4,
      'Students may need a deadline reminder. Consider sending a follow-up message with the submission link.',
    );

    return this.repository.create({
      type: InstructorContentType.INSIGHT,
      content,
      teacherId: params.teacherId,
      classroomId: params.classroomId,
      assignmentId: params.assignmentId,
      metadata: { source: 'assignment.overdue' },
    });
  }

  async generateWarmUp(params: {
    classroomId: string;
    lessonId?: string;
    teacherId?: string;
  }): Promise<InstructorContent> {
    const prompt = `You are a curriculum designer.
Generate a 5-minute no-materials warm-up activity for a classroom.
${params.lessonId ? `Lesson context ID: ${params.lessonId}` : ''}
The activity should engage students immediately and activate prior knowledge.
Format: a short title, then 3-4 step instructions.`;
    const content = await this.generateText(
      prompt,
      200,
      0.7,
      'Think-Pair-Share: Ask students to spend 2 minutes writing one thing they remember from last class, then share with a partner.',
    );

    return this.repository.create({
      type: InstructorContentType.WARM_UP,
      content,
      teacherId: params.teacherId,
      classroomId: params.classroomId,
      metadata: { source: 'engagement.drop', lessonId: params.lessonId },
    });
  }

  async generateRubric(params: {
    assignmentTitle: string;
    description?: string;
    maxScore: number;
    teacherId: string;
    assignmentId?: string;
  }): Promise<InstructorContent> {
    const prompt = `You are a curriculum designer creating a grading rubric.
Assignment: "${params.assignmentTitle}"
${params.description ? `Description: ${params.description}` : ''}
Total points: ${params.maxScore}
Create 3-5 rubric criteria. For each criterion provide:
- Criterion name
- Points allocated
- Excellent performance description (1 sentence)
- Needs improvement description (1 sentence)
Format as a numbered list. Keep it concise and practical.`;
    const content = await this.generateText(
      prompt,
      400,
      0.4,
      'Unable to generate rubric at this time. Please try again shortly.',
    );

    return this.repository.create({
      type: InstructorContentType.RUBRIC_DRAFT,
      content,
      teacherId: params.teacherId,
      assignmentId: params.assignmentId,
      metadata: {
        assignmentTitle: params.assignmentTitle,
        maxScore: params.maxScore,
      },
    });
  }

  async generateFeedback(params: {
    submissionId: string;
    teacherId: string;
  }): Promise<InstructorContent> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: params.submissionId },
      include: {
        assignment: { select: { title: true, maxScore: true } },
        grade: { select: { score: true } },
      },
    });
    if (!submission) throw new NotFoundException('Submission not found');

    const prompt = `You are a teacher writing constructive feedback for a student.
Assignment: "${submission.assignment.title}"
Score: ${submission.grade?.score ?? 'not yet graded'} / ${submission.assignment.maxScore}
Write 3-4 sentences of encouraging, specific, actionable feedback.
Do not mention the numeric score. Focus on effort, strengths, and
one concrete improvement suggestion.`;
    const content = await this.generateText(
      prompt,
      180,
      0.5,
      'Good effort on this assignment. Review the assignment criteria and consider where you could strengthen your response.',
    );

    return this.repository.create({
      type: InstructorContentType.FEEDBACK_DRAFT,
      content,
      teacherId: params.teacherId,
      assignmentId: submission.assignmentId,
      metadata: { submissionId: params.submissionId },
    });
  }

  async getContentForTeacher(teacherId: string): Promise<InstructorContent[]> {
    return this.repository.findForTeacher(teacherId);
  }

  async dismissContent(
    id: string,
    requestingUserId: string,
  ): Promise<InstructorContent> {
    const item = await this.repository.findById(id);
    if (!item) throw new NotFoundException('Content not found');
    if (item.teacherId && item.teacherId !== requestingUserId) {
      throw new ForbiddenException();
    }
    return this.repository.dismiss(id);
  }

  private async generateText(
    prompt: string,
    maxTokens: number,
    temperature: number,
    fallback: string,
  ): Promise<string> {
    try {
      const ai = await this.aiRouterService.chat({
        prompt,
        maxTokens,
        temperature,
      });
      return ai.text || fallback;
    } catch {
      return fallback;
    }
  }

  private courseContentFallback(
    dto: GenerateCourseContentDto,
  ): { lessonContent: string; quizContent: string } {
    const lessonContent = {
      type: 'lesson',
      standard: dto.standard ?? null,
      learningTargets: [
        `I can explain the key concepts of ${dto.topic} - ${dto.stage}.`,
        `I can apply ${dto.stage} strategies to solve problems involving ${dto.topic}.`,
        'I can show my thinking with clear steps and explanations.',
      ],
      instruction: `In this unit, students study ${dto.topic} through the lens of ${dto.stage}.

Start by defining the key vocabulary, then model one worked example. Emphasize how to identify the important information, choose a strategy, and check that the answer makes sense.`,
      guidedProblems: [
        {
          id: 1,
          statement: `Solve a basic ${dto.topic} problem using ${dto.stage}.`,
          answer: '1',
          solution:
            'Step 1: Identify the given information.\nStep 2: Choose the correct strategy.\nStep 3: Solve and check.\nAnswer: 1',
          imageDescription: 'right triangle',
        },
        {
          id: 2,
          statement: `Explain why the ${dto.stage} strategy works for ${dto.topic}.`,
          answer: 'because',
          solution:
            'A strong explanation connects the strategy to the structure of the problem.\nAnswer: because',
        },
        {
          id: 3,
          statement: `Apply ${dto.stage} to a real-world ${dto.topic} situation.`,
          answer: 'real world',
          solution:
            'Translate the situation into a math problem, solve, then interpret the result.\nAnswer: real world',
        },
      ],
      independentProblems: [
        {
          id: 4,
          statement: `Practice ${dto.stage} with a new ${dto.topic} example.`,
          answer: '2',
          solution: 'Use the modeled process from the lesson.\nAnswer: 2',
        },
        {
          id: 5,
          statement: `Solve another ${dto.topic} problem independently.`,
          answer: '3',
          solution: 'Show each step and check the result.\nAnswer: 3',
        },
        {
          id: 6,
          statement: `Create your own ${dto.topic} problem that uses ${dto.stage}.`,
          answer: 'student response',
          solution:
            'A complete answer includes a problem, a solution, and a short explanation.\nAnswer: student response',
        },
      ],
      exitTicket: [
        `What is the most important idea from ${dto.stage}?`,
        `How could you use ${dto.topic} outside of class?`,
      ],
      parentSummary: `Students practiced ${dto.topic} with a focus on ${dto.stage}. Ask your student to explain one problem they solved and how they checked their answer.`,
    };

    const quizContent = [
      {
        question: `What is the main goal of ${dto.stage} in ${dto.topic}?`,
        options: [
          'Understand and apply the concept',
          'Avoid showing work',
          'Guess quickly',
          'Skip hard problems',
        ],
        answer: 0,
        solution:
          'The goal is to understand the concept and apply it with clear reasoning.',
      },
      {
        question: 'What should students do first when solving a new problem?',
        options: [
          'Write a random answer',
          'Identify the given information',
          'Erase the problem',
          'Choose the longest option',
        ],
        answer: 1,
        solution:
          'Students should first identify what information is given and what they need to find.',
      },
      {
        question: 'Why is checking an answer important?',
        options: [
          'It makes the page longer',
          'It replaces the solution',
          'It helps confirm the answer makes sense',
          'It changes the question',
        ],
        answer: 2,
        solution:
          'Checking helps confirm that the answer is reasonable for the problem.',
      },
      {
        question: 'Which response best shows mathematical thinking?',
        options: [
          'Only the answer',
          'A guess',
          'A copied definition',
          'Steps with a brief explanation',
        ],
        answer: 3,
        solution:
          'Clear steps and explanation show how the student reached the answer.',
      },
      {
        question: `How can ${dto.topic} connect to real life?`,
        options: [
          'By modeling useful situations',
          'Only by memorizing words',
          'By ignoring context',
          'Only during tests',
        ],
        answer: 0,
        solution:
          'Math concepts become useful when students apply them to real situations.',
      },
    ];

    return {
      lessonContent: JSON.stringify(lessonContent),
      quizContent: JSON.stringify(quizContent),
    };
  }
}
