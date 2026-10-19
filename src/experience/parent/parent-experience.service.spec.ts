import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ParentExperienceService } from './parent-experience.service';

function build(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'p1', role: Role.PARENT, email: 'mom@gmail.com', maxStudents: 3,
        profile: { firstName: 'Dana' },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    parentStudentLink: {
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue({ parentId: 'p1', studentId: 's1' }),
    },
    ...overrides,
  };
  prisma.$transaction = jest.fn().mockResolvedValue({
    id: 's1', email: 'mom+maya@gmail.com', seatsUsed: 1, seats: 3,
  });
  const email: any = { sendChildLoginEmail: jest.fn().mockResolvedValue(undefined) };
  const svc = new ParentExperienceService(prisma, email);
  return { svc, prisma, email };
}

describe('ParentExperienceService child login', () => {
  it('emails the parent the child username after adding a child', async () => {
    const { svc, email } = build();
    (svc as any).prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'p1', role: Role.PARENT, email: 'mom@gmail.com', maxStudents: 3, profile: { firstName: 'Dana' } })
      .mockResolvedValue(null);
    const out = await svc.addChild('p1', { firstName: 'Maya', lastName: 'Lee', password: 'secret123' } as any);
    expect(out.email).toBe('mom+maya@gmail.com');
    expect(email.sendChildLoginEmail).toHaveBeenCalledWith('mom@gmail.com', 'Maya', 'mom+maya@gmail.com', 'Dana');
  });

  it('still adds the child when the email fails', async () => {
    const { svc, email } = build();
    email.sendChildLoginEmail.mockRejectedValue(new Error('resend down'));
    (svc as any).prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'p1', role: Role.PARENT, email: 'mom@gmail.com', maxStudents: 3, profile: null })
      .mockResolvedValue(null);
    await expect(svc.addChild('p1', { firstName: 'Maya', lastName: 'Lee', password: 'secret123' } as any))
      .resolves.toMatchObject({ id: 's1' });
  });

  it('resets the password only for a linked child', async () => {
    const { svc, prisma } = build();
    await expect(svc.resetChildPassword('p1', 's1', 'newpass123')).resolves.toEqual({ studentId: 's1', reset: true });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' } }));
    prisma.parentStudentLink.findUnique.mockResolvedValue(null);
    await expect(svc.resetChildPassword('p1', 'other', 'newpass123')).rejects.toBeInstanceOf(NotFoundException);
  });
});
