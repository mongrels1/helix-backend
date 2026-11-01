import { AIRouterService } from './ai-router.service';

const create = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create } })),
}));

/** LP3: the shared prefix travels as its own block, cached only when asked. */
describe('AIRouterService shared prefix / prompt caching', () => {
  const config = { get: (k: string) => (k === 'ai.anthropicKey' ? 'test-key' : undefined) };
  const svc = new AIRouterService(config as never, { sendAdminAlert: jest.fn() } as never);

  beforeEach(() => {
    create.mockReset().mockResolvedValue({
      content: [{ type: 'text', text: '{}' }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
      stop_reason: 'end_turn',
    });
  });

  it('sends the prefix first, with cache_control only when cachePrefix is set', async () => {
    const res = await svc.chat({
      prompt: 'DAY PART',
      sharedPrefix: 'SHARED',
      cachePrefix: true,
      systemPrompt: 'SYS',
      preferredProvider: 'claude',
    });
    const body = create.mock.calls[0][0];
    expect(body.system).toBe('SYS');
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'SHARED', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'DAY PART' },
    ]);
    expect(res.cacheReadTokens).toBe(4000);
    expect(res.tokensUsed).toBe(4150);

    await svc.chat({ prompt: 'DAY PART', sharedPrefix: 'SHARED', systemPrompt: 'SYS', preferredProvider: 'claude' });
    expect(create.mock.calls[1][0].messages[0].content[0]).toEqual({ type: 'text', text: 'SHARED' });
  });

  it('without a prefix the request is unchanged', async () => {
    await svc.chat({ prompt: 'P', systemPrompt: 'SYS', preferredProvider: 'claude' });
    expect(create.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'SYS\n\nP' }]);
  });
});
