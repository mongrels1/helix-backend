import { BadRequestException } from '@nestjs/common';
import { LessonPlanService } from './lesson-plan.service';

/**
 * LP1: day status and dates, end to end through the service with the AI and
 * the sidecar mocked. The sidecar fill is positional, so the plan it receives
 * must always have one day per template day, in template order.
 */

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function teachReply(name: string) {
  return JSON.stringify({
    days: [
      {
        name,
        standard: '7.PAR.4.1',
        learning_target: `target for ${name}`,
        segments: [{ teacher_actions: 'T', student_actions: 'S' }],
      },
    ],
    small_group: [{ rationale: 'r' }],
  });
}

function makeService(chat: jest.Mock) {
  const sidecar = {
    fill: jest.fn().mockResolvedValue({
      docx: Buffer.from('PK'),
      structureLocked: true,
      pacingOk: true,
      summary: null,
    }),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const svc = new LessonPlanService({ chat } as never, sidecar as never, config as never);
  return { svc, sidecar };
}

async function jobWithTemplate(svc: LessonPlanService) {
  const { jobId } = svc.createJob('t1');
  // set a template without calling the sidecar parser
  const job = (svc as unknown as { jobs: Map<string, { template?: unknown; resources: unknown[] }> }).jobs.get(jobId)!;
  job.template = { file: { buffer: Buffer.from(''), originalname: 'Weekly.docx' }, fieldMap: { days: WEEK } };
  job.resources = [
    { filename: 'pacing.pdf', type: 'pacing', text: 'Nov 3  ILD – Unit Rate ILD Worksheet' },
  ];
  return jobId;
}

const base = {
  periodMinutes: 55,
  days: WEEK,
  segmentsPerDay: 3,
  differentiationGroups: ['ESOL'],
};

jest.mock('./lesson-plan.docx-header', () => ({
  patchDocxHeader: jest.fn(async (b: Buffer, f: { dates?: string }) => {
    (global as unknown as { __dates?: string }).__dates = f.dates;
    return b;
  }),
}));

describe('LessonPlanService.generate with day status (LP1)', () => {
  it('legacy request: 5 teaching days, 5 AI calls, same order', async () => {
    const chat = jest.fn(async ({ prompt }: { prompt: string }) => {
      const name = WEEK.find((d) => prompt.includes(`["${d}"]`))!;
      return { text: teachReply(name), provider: 'claude', tokensUsed: 1000 };
    });
    const { svc, sidecar } = makeService(chat);
    const id = await jobWithTemplate(svc);
    const out = await svc.generate(id, 't1', { ...base } as never);
    expect(chat).toHaveBeenCalledTimes(5);
    expect(out.aiCalls).toBe(5);
    expect(out.tokensUsed).toBe(5000);
    const plan = sidecar.fill.mock.calls[0][0].plan;
    expect(plan.days.map((d: { name: string }) => d.name)).toEqual(WEEK);
  });

  it('Tue = ILD, Fri = no school: 3 full calls + 1 short ILD call, no call for Friday, columns kept', async () => {
    const chat = jest.fn(async ({ prompt, maxTokens }: { prompt: string; maxTokens: number }) => {
      if (prompt.startsWith('Write ONE Independent Learning Day')) {
        expect(maxTokens).toBe(2500);
        expect(prompt).toContain('Tuesday, 3 Nov 2026');
        return {
          text: JSON.stringify({
            standard: '7.PAR.4.1',
            student_directions: '1. Open the worksheet.',
            assignment: '1) 3:12',
            answer_key: '1) 0.25',
          }),
          provider: 'claude',
          tokensUsed: 400,
        };
      }
      const name = WEEK.find((d) => prompt.includes(`["${d}"]`))!;
      expect(prompt).toContain('independent learning day (no class session)');
      return { text: teachReply(name), provider: 'claude', tokensUsed: 1000 };
    });
    const { svc, sidecar } = makeService(chat);
    const id = await jobWithTemplate(svc);
    const out = await svc.generate(id, 't1', {
      ...base,
      weekStart: '2026-11-02',
      dayPlan: [
        { name: 'Tuesday', status: 'ild', reason: 'Election Day' },
        { name: 'Friday', status: 'no_school', reason: 'Professional Learning Day' },
      ],
    } as never);

    expect(chat).toHaveBeenCalledTimes(4);
    expect(out.aiCalls).toBe(4);
    expect(out.tokensUsed).toBe(3400);
    expect(out.days.map((d) => d.status)).toEqual(['teach', 'ild', 'teach', 'teach', 'no_school']);

    const plan = sidecar.fill.mock.calls[0][0].plan;
    expect(plan.days.map((d: { name: string }) => d.name)).toEqual(WEEK);
    expect(plan.days[1].status).toBe('ild');
    expect(plan.days[1].segments[0].teacher_actions).toBe('Independent learning day – no class session.');
    expect(plan.days[4].standard).toBe('No school – Professional Learning Day.');
    expect((global as unknown as { __dates?: string }).__dates).toBe('Nov 2–6, 2026');
  });

  it("the teacher's own 'Week of' text still wins in the header", async () => {
    const chat = jest.fn(async ({ prompt }: { prompt: string }) => {
      const name = WEEK.find((d) => prompt.includes(`["${d}"]`))!;
      return { text: teachReply(name), provider: 'claude', tokensUsed: 1 };
    });
    const { svc } = makeService(chat);
    const id = await jobWithTemplate(svc);
    await svc.generate(id, 't1', { ...base, week: 'Week 12', weekStart: '2026-11-02' } as never);
    expect((global as unknown as { __dates?: string }).__dates).toBe('Week 12');
  });

  it('a failed day becomes a visible placeholder in its own column, never dropped', async () => {
    const chat = jest.fn(async ({ prompt }: { prompt: string }) => {
      const name = WEEK.find((d) => prompt.includes(`["${d}"]`))!;
      if (name === 'Wednesday') return { text: 'not json', provider: 'claude', tokensUsed: 10 };
      if (name === 'Thursday') throw new Error('timeout');
      return { text: teachReply(name), provider: 'claude', tokensUsed: 1 };
    });
    const { svc, sidecar } = makeService(chat);
    const id = await jobWithTemplate(svc);
    await svc.generate(id, 't1', { ...base } as never);
    const plan = sidecar.fill.mock.calls[0][0].plan;
    expect(plan.days.map((d: { name: string }) => d.name)).toEqual(WEEK);
    expect(plan.days[2].status).toBe('failed');
    expect(plan.days[3].status).toBe('failed');
    expect(plan.days[4].learning_target).toBe('target for Friday');
  });

  it('a week that is entirely no school makes no AI call and reports aiCalls 0', async () => {
    const chat = jest.fn();
    const { svc } = makeService(chat);
    const id = await jobWithTemplate(svc);
    const out = await svc.generate(id, 't1', {
      ...base,
      dayPlan: WEEK.map((name) => ({ name, status: 'no_school' })),
    } as never);
    expect(chat).not.toHaveBeenCalled();
    expect(out.aiCalls).toBe(0);
  });

  it('every AI day failing is still an error', async () => {
    const chat = jest.fn(async () => ({ text: 'nope', provider: 'claude', tokensUsed: 1 }));
    const { svc } = makeService(chat);
    const id = await jobWithTemplate(svc);
    await expect(svc.generate(id, 't1', { ...base } as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('suggests Tuesday as an ILD from the uploaded pacing text', async () => {
    const { svc } = makeService(jest.fn());
    const id = await jobWithTemplate(svc);
    expect(svc.suggestDays(id, 't1', WEEK, '2026-11-02')).toEqual([
      { name: 'Tuesday', date: '2026-11-03', status: 'ild', evidence: 'Nov 3 ILD – Unit Rate ILD Worksheet' },
    ]);
  });
});
