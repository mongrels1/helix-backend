/**
 * Real-database test of per-student access codes. Skipped unless
 * INTEGRATION_DATABASE_URL points at a throwaway Postgres with every migration
 * applied — it creates and deletes rows. Never point it at production.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://... npx jest institutional-enrollment.integration
 */
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { InstitutionalEnrollmentService } from './institutional-enrollment.service';
import { addMonths, hashAccessCode } from './access-code';

const URL = process.env.INTEGRATION_DATABASE_URL;
const run = URL ? describe : describe.skip;

run('institutional enrollment with access codes (real DB)', () => {
  let prisma: PrismaService;
  let svc: InstitutionalEnrollmentService;
  let ent: EntitlementService;
  const suffix = randomUUID().slice(0, 8);
  const codeToken = `tok-code-${suffix}`;
  const openToken = `tok-open-${suffix}`;
  const CODES = ['RDN-TEST-AAA1', 'RDN-TEST-BBB2', 'RDN-TEST-CCC3', 'RDN-TEST-DDD4'].map((c) => `${c}${suffix.slice(0, 2)}`);

  const dto = (email: string, accessCode?: string) => ({
    studentFirstName: 'Test', studentLastName: 'Student', gradeLevel: '7',
    parentName: 'Test Parent', parentEmail: email, relationship: 'Parent',
    password: 'correct-horse-battery', consentAccess: true, consentProviderAndAi: true,
    consentDataUse: true, consentHoldHarmless: true, consentVersion: 'test', consentText: 'test',
    ...(accessCode !== undefined ? { accessCode } : {}),
  }) as any;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    prisma = new PrismaService();
    await prisma.$connect();
    const email = { sendWelcomeEmail: jest.fn().mockResolvedValue(undefined) } as any;
    const config = { get: () => 'https://app.example.test' } as any;
    svc = new InstitutionalEnrollmentService(prisma, email, config);
    ent = new EntitlementService(prisma);
    const coded = await prisma.organization.create({
      data: { name: 'Code School', slug: `code-${suffix}`, publicEnrollmentEnabled: true,
        enrollmentToken: codeToken, enrollmentCap: 100, requireAccessCode: true },
    });
    await prisma.organization.create({
      data: { name: 'Open School', slug: `open-${suffix}`, publicEnrollmentEnabled: true,
        enrollmentToken: openToken, enrollmentCap: 100 },
    });
    await prisma.enrollmentAccessCode.createMany({
      data: CODES.map((c) => ({ organizationId: coded.id, codeHash: hashAccessCode(c), freeMonths: 10 })),
    });
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it('describes the school as requiring a code', async () => {
    expect((await svc.describe(codeToken)).requiresAccessCode).toBe(true);
    expect((await svc.describe(openToken)).requiresAccessCode).toBe(false);
  });

  it('refuses the shared token without a code, and with an unknown code', async () => {
    await expect(svc.enroll(codeToken, dto(`a1-${suffix}@x.test`))).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.enroll(codeToken, dto(`a2-${suffix}@x.test`, 'RDN-NOPE-NOPE'))).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.user.count({ where: { email: { in: [`a1-${suffix}@x.test`, `a2-${suffix}@x.test`] } } })).toBe(0);
  });

  it('enrolls with a valid code, typed loosely, and ends free access in 10 months', async () => {
    const before = new Date();
    const res = await svc.enroll(codeToken, dto(`ok-${suffix}@x.test`, CODES[0].toLowerCase().replace(/-/g, ' ')));
    const parent = await prisma.user.findUnique({ where: { email: `ok-${suffix}@x.test` } });
    expect(parent?.planSource).toBe('INSTITUTIONAL');
    expect(parent?.stripeCustomerId ?? null).toBeNull();
    const expected = addMonths(before, 10).getTime();
    expect(Math.abs((parent!.planRenewsAt as Date).getTime() - expected)).toBeLessThan(60_000);
    expect(res.freeAccessEndsAt).toBe((parent!.planRenewsAt as Date).toISOString());
    const code = await prisma.enrollmentAccessCode.findUnique({ where: { codeHash: hashAccessCode(CODES[0]) } });
    expect(code?.redeemedAt).not.toBeNull();
    expect(code?.redeemedByParentId).toBe(parent!.id);

    // The child is entitled now, through the parent...
    const link = await prisma.parentStudentLink.findFirst({ where: { parentId: parent!.id } });
    expect(await ent.isEntitled(link!.studentId)).toBe(true);
    // ...and not after the free period ends: back to unpaid, nothing charged.
    await prisma.user.update({ where: { id: parent!.id }, data: { planRenewsAt: new Date(Date.now() - 1000) } });
    expect(await ent.isEntitled(link!.studentId)).toBe(false);
    expect(await ent.isEntitled(parent!.id)).toBe(false);
  });

  it('refuses a code that has already been used', async () => {
    await expect(svc.enroll(codeToken, dto(`reuse-${suffix}@x.test`, CODES[0]))).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.user.count({ where: { email: `reuse-${suffix}@x.test` } })).toBe(0);
  });

  it('lets exactly one of two simultaneous submits win one code', async () => {
    const results = await Promise.allSettled([
      svc.enroll(codeToken, dto(`race1-${suffix}@x.test`, CODES[1])),
      svc.enroll(codeToken, dto(`race2-${suffix}@x.test`, CODES[1])),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.user.count({ where: { email: { in: [`race1-${suffix}@x.test`, `race2-${suffix}@x.test`] } } })).toBe(1);
  });

  it('does not burn the code when enrollment fails for another reason', async () => {
    // Existing email -> 409 before the transaction; a duplicate inside the
    // transaction would roll back. Either way the code must stay unused.
    await expect(svc.enroll(codeToken, dto(`ok-${suffix}@x.test`, CODES[2]))).rejects.toBeTruthy();
    const code = await prisma.enrollmentAccessCode.findUnique({ where: { codeHash: hashAccessCode(CODES[2]) } });
    expect(code?.redeemedAt).toBeNull();
  });

  it('leaves schools without codes exactly as before: free, no end date', async () => {
    await svc.enroll(openToken, dto(`open-${suffix}@x.test`));
    const parent = await prisma.user.findUnique({ where: { email: `open-${suffix}@x.test` } });
    expect(parent?.planRenewsAt).toBeNull();
    expect(parent?.planStatus).toBe('active');
  });
});
