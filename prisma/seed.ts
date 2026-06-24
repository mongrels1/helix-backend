import { PrismaClient, Role, SubmissionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required seed env var: ${name}`);
  return value;
}

async function upsertUser(input: {
  id: string;
  email: string;
  role: Role;
  firstName: string;
  lastName: string;
  password: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.user.upsert({
    where: { email: input.email },
    create: {
      id: input.id,
      email: input.email,
      passwordHash,
      role: input.role,
      profile: { create: { firstName: input.firstName, lastName: input.lastName } },
    },
    update: {
      passwordHash,
      role: input.role,
      profile: {
        upsert: {
          create: { firstName: input.firstName, lastName: input.lastName },
          update: { firstName: input.firstName, lastName: input.lastName },
        },
      },
    },
  });
}

async function main() {
  const student = await upsertUser({
    id: 'e2e-student-user',
    email: required('E2E_STUDENT_EMAIL'),
    role: Role.STUDENT,
    firstName: 'E2E',
    lastName: 'Student',
    password: required('E2E_STUDENT_PASS'),
  });
  const teacher = await upsertUser({
    id: 'e2e-teacher-user',
    email: required('E2E_TEACHER_EMAIL'),
    role: Role.TEACHER,
    firstName: 'E2E',
    lastName: 'Teacher',
    password: required('E2E_TEACHER_PASS'),
  });
  const parent = await upsertUser({
    id: 'e2e-parent-user',
    email: required('E2E_PARENT_EMAIL'),
    role: Role.PARENT,
    firstName: 'E2E',
    lastName: 'Parent',
    password: required('E2E_PARENT_PASS'),
  });
  const admin = await upsertUser({
    id: 'e2e-admin-user',
    email: required('E2E_ADMIN_EMAIL'),
    role: Role.ORG_ADMIN,
    firstName: 'E2E',
    lastName: 'Admin',
    password: required('E2E_ADMIN_PASS'),
  });
  const superAdmin = await upsertUser({
    id: 'e2e-super-user',
    email: required('E2E_SUPER_EMAIL'),
    role: Role.SUPER_ADMIN,
    firstName: 'E2E',
    lastName: 'SuperAdmin',
    password: required('E2E_SUPER_PASS'),
  });

  const organization = await prisma.organization.upsert({
    where: { slug: 'e2e-academy' },
    create: { id: 'e2e-org', name: 'E2E Academy', slug: 'e2e-academy' },
    update: { name: 'E2E Academy' },
  });

  for (const user of [student, teacher, parent, admin, superAdmin]) {
    await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
      create: { userId: user.id, organizationId: organization.id, role: user.role },
      update: { role: user.role },
    });
  }

  const classroom = await prisma.classroom.upsert({
    where: { id: 'e2e-classroom' },
    create: {
      id: 'e2e-classroom',
      name: 'E2E Classroom',
      description: 'Seeded classroom for E2E coverage',
      organizationId: organization.id,
      teacherId: teacher.id,
    },
    update: {
      name: 'E2E Classroom',
      organizationId: organization.id,
      teacherId: teacher.id,
    },
  });

  await prisma.enrollment.upsert({
    where: { classroomId_studentId: { classroomId: classroom.id, studentId: student.id } },
    create: { classroomId: classroom.id, studentId: student.id },
    update: {},
  });

  await prisma.parentStudentLink.upsert({
    where: { parentId_studentId: { parentId: parent.id, studentId: student.id } },
    create: { parentId: parent.id, studentId: student.id },
    update: {},
  });

  const course = await prisma.course.upsert({
    where: { id: 'e2e-course' },
    create: {
      id: 'e2e-course',
      title: 'E2E Course',
      description: 'Seeded course for E2E coverage',
      classroomId: classroom.id,
    },
    update: {
      title: 'E2E Course',
      classroomId: classroom.id,
    },
  });

  const draftAssignment = await prisma.assignment.upsert({
    where: { id: 'e2e-submit-assignment' },
    create: {
      id: 'e2e-submit-assignment',
      title: 'E2E Submit Assignment',
      description: 'Student submission test assignment',
      maxScore: 100,
      skillTags: ['e2e-submit'],
      classroomId: classroom.id,
      courseId: course.id,
    },
    update: {
      title: 'E2E Submit Assignment',
      maxScore: 100,
      skillTags: ['e2e-submit'],
      classroomId: classroom.id,
      courseId: course.id,
    },
  });

  const gradeAssignment = await prisma.assignment.upsert({
    where: { id: 'e2e-grade-assignment' },
    create: {
      id: 'e2e-grade-assignment',
      title: 'E2E Grade Assignment',
      description: 'Teacher grading test assignment',
      maxScore: 100,
      skillTags: ['e2e-grade'],
      classroomId: classroom.id,
      courseId: course.id,
    },
    update: {
      title: 'E2E Grade Assignment',
      maxScore: 100,
      skillTags: ['e2e-grade'],
      classroomId: classroom.id,
      courseId: course.id,
    },
  });

  await prisma.submission.upsert({
    where: { assignmentId_studentId: { assignmentId: draftAssignment.id, studentId: student.id } },
    create: {
      id: 'e2e-draft-submission',
      assignmentId: draftAssignment.id,
      studentId: student.id,
      status: SubmissionStatus.DRAFT,
    },
    update: {
      status: SubmissionStatus.DRAFT,
      content: null,
      fileUrl: null,
      submittedAt: null,
    },
  });

  await prisma.submission.upsert({
    where: { assignmentId_studentId: { assignmentId: gradeAssignment.id, studentId: student.id } },
    create: {
      id: 'e2e-submitted-submission',
      assignmentId: gradeAssignment.id,
      studentId: student.id,
      status: SubmissionStatus.SUBMITTED,
      content: 'E2E submitted work',
      submittedAt: new Date(),
    },
    update: {
      status: SubmissionStatus.SUBMITTED,
      content: 'E2E submitted work',
      submittedAt: new Date(),
    },
  });

  console.log('E2E seed complete.');
}

main().finally(() => prisma.$disconnect());
