import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIRouterService } from './ai-router.service';

describe('AIRouterService', () => {
  let service: AIRouterService;

  beforeEach(() => {
    service = new AIRouterService({
      get: jest.fn(() => ''),
    } as unknown as ConfigService);
  });

  it('falls back in standard order from openai to gemini to claude', async () => {
    const calls: string[] = [];
    jest
      .spyOn(service as any, 'callOpenAI')
      .mockImplementation(async () => {
        calls.push('openai');
        throw new Error('OpenAI failed');
      });
    jest
      .spyOn(service as any, 'callGemini')
      .mockImplementation(async () => {
        calls.push('gemini');
        return {
          text: 'Gemini response',
          provider: 'gemini',
          tokensUsed: 0,
          latencyMs: 25,
        };
      });
    jest.spyOn(service as any, 'callClaude').mockImplementation(async () => {
      calls.push('claude');
      return {
        text: 'Claude response',
        provider: 'claude',
        tokensUsed: 0,
        latencyMs: 25,
      };
    });

    await expect(service.chat({ prompt: 'hello' })).resolves.toMatchObject({
      provider: 'gemini',
    });
    expect(calls).toEqual(['openai', 'gemini']);
  });

  it('tries preferred provider first then remaining providers in chain order', async () => {
    const calls: string[] = [];
    jest
      .spyOn(service as any, 'callOpenAI')
      .mockImplementation(async () => {
        calls.push('openai');
        return {
          text: 'OpenAI response',
          provider: 'openai',
          tokensUsed: 1,
          latencyMs: 25,
        };
      });
    jest
      .spyOn(service as any, 'callGemini')
      .mockImplementation(async () => {
        calls.push('gemini');
        throw new Error('Gemini failed');
      });
    jest.spyOn(service as any, 'callClaude').mockImplementation(async () => {
      calls.push('claude');
      throw new Error('Claude failed');
    });

    await expect(
      service.chat({ prompt: 'hello', preferredProvider: 'gemini' }),
    ).resolves.toMatchObject({ provider: 'openai' });
    expect(calls).toEqual(['gemini', 'openai']);
  });

  it('throws a sanitized error when all providers fail', async () => {
    jest
      .spyOn(service as any, 'callOpenAI')
      .mockRejectedValue(new Error('raw openai error'));
    jest
      .spyOn(service as any, 'callGemini')
      .mockRejectedValue(new Error('raw gemini error'));
    jest
      .spyOn(service as any, 'callClaude')
      .mockRejectedValue(new Error('raw claude error'));

    await expect(service.chat({ prompt: 'hello' })).rejects.toMatchObject({
      message: 'AI service temporarily unavailable',
    });
    await expect(service.chat({ prompt: 'hello' })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('times out slow provider attempts', async () => {
    await expect(
      (service as any).withTimeout(new Promise(() => undefined), 1),
    ).rejects.toThrow('Timeout after 1ms');
  });

  it('reports provider configured status from config keys', () => {
    service = new AIRouterService({
      get: jest.fn((key: string) =>
        key === 'ai.openaiKey' ? 'configured-key' : '',
      ),
    } as unknown as ConfigService);

    expect(service.getProviderConfigs()).toEqual([
      { name: 'openai', configured: true },
      { name: 'gemini', configured: false },
      { name: 'claude', configured: false },
    ]);
  });
});
