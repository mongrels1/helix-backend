export const mockAIRouterService = {
  chat: jest.fn().mockResolvedValue({
    text: 'Mock AI response',
    provider: 'openai' as const,
    tokensUsed: 42,
    latencyMs: 100,
  }),
};
