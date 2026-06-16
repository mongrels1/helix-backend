import { ForbiddenException } from '@nestjs/common';
import { MessagingRepository } from './messaging.repository';
import { MessagingService } from './messaging.service';

describe('MessagingService', () => {
  let service: MessagingService;
  let repository: jest.Mocked<MessagingRepository>;

  const thread = {
    id: 'thread-1',
    subject: 'Planning',
    participants: [
      { id: 'participant-1', threadId: 'thread-1', userId: 'creator-1' },
      { id: 'participant-2', threadId: 'thread-1', userId: 'user-2' },
    ],
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    repository = {
      findThreadsByUser: jest.fn(),
      findThreadById: jest.fn(),
      createThread: jest.fn(),
      addMessage: jest.fn(),
      getMessages: jest.fn(),
      isParticipant: jest.fn(),
    } as unknown as jest.Mocked<MessagingRepository>;
    service = new MessagingService(repository);
  });

  it('auto-adds the creator when creating a thread', async () => {
    repository.createThread.mockResolvedValue(thread as any);

    await service.createThread(
      { subject: 'Planning', participantIds: ['user-2'] },
      'creator-1',
    );

    expect(repository.createThread).toHaveBeenCalledWith('Planning', [
      'creator-1',
      'user-2',
    ]);
  });

  it('deduplicates the creator in participant list', async () => {
    repository.createThread.mockResolvedValue(thread as any);

    await service.createThread(
      { subject: 'Planning', participantIds: ['creator-1', 'user-2'] },
      'creator-1',
    );

    expect(repository.createThread).toHaveBeenCalledWith('Planning', [
      'creator-1',
      'user-2',
    ]);
  });

  it('blocks non-participants from sending messages', async () => {
    repository.isParticipant.mockResolvedValue(false);

    await expect(
      service.sendMessage('thread-1', 'outsider-1', { content: 'Nope' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns paginated messages for participants', async () => {
    repository.isParticipant.mockResolvedValue(true);
    repository.getMessages.mockResolvedValue([
      [
        {
          id: 'message-1',
          threadId: 'thread-1',
          senderId: 'creator-1',
          content: 'Hello',
          createdAt: new Date(),
        },
      ],
      1,
    ]);

    await expect(
      service.getMessages('thread-1', 'creator-1', 1, 50),
    ).resolves.toMatchObject({ meta: { total: 1 } });
  });
});
