export class ThreadEntity {
  id!: string;
  subject!: string | null;
  participants!: {
    id: string;
    threadId: string;
    userId: string;
    joinedAt: Date;
  }[];
  messages!: {
    id: string;
    threadId: string;
    senderId: string;
    content: string;
    createdAt: Date;
  }[];
  createdAt!: Date;
  updatedAt!: Date;
}
