import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  AIProvider,
  AIRequest,
  AIResponse,
  ConversationMessage,
} from './ai-router.types';

@Injectable()
export class AIRouterService {
  private readonly logger = new Logger(AIRouterService.name);
  private readonly timeoutMs = 8000;
  private readonly providerChain: AIProvider[] = ['openai', 'gemini', 'claude'];

  constructor(private readonly config: ConfigService) {}

  async chat(req: AIRequest): Promise<AIResponse> {
    const providers = this.getProviderOrder(req.preferredProvider);

    for (const provider of providers) {
      try {
        const response = await this.withTimeout(
          this.callProvider(provider, req),
          this.timeoutMs,
        );
        this.logger.log(
          `AI provider=${response.provider} latencyMs=${response.latencyMs} tokens=${response.tokensUsed}`,
        );
        return response;
      } catch (error) {
        this.logger.warn(`AI provider ${provider} failed: ${String(error)}`);
      }
    }

    throw new InternalServerErrorException('AI service temporarily unavailable');
  }

  getProviderConfigs(): { name: AIProvider; configured: boolean }[] {
    return [
      {
        name: 'openai',
        configured: Boolean(this.config.get<string>('ai.openaiKey')),
      },
      {
        name: 'gemini',
        configured: Boolean(this.config.get<string>('ai.googleKey')),
      },
      {
        name: 'claude',
        configured: Boolean(this.config.get<string>('ai.anthropicKey')),
      },
    ];
  }

  private async callProvider(
    provider: AIProvider,
    req: AIRequest,
  ): Promise<AIResponse> {
    switch (provider) {
      case 'openai':
        return this.callOpenAI(req);
      case 'gemini':
        return this.callGemini(req);
      case 'claude':
        return this.callClaude(req);
    }
  }

  private getProviderOrder(preferredProvider?: AIProvider): AIProvider[] {
    if (!preferredProvider) return this.providerChain;
    return [
      preferredProvider,
      ...this.providerChain.filter((provider) => provider !== preferredProvider),
    ];
  }

  private async callOpenAI(req: AIRequest): Promise<AIResponse> {
    const apiKey = this.config.get<string>('ai.openaiKey');
    if (!apiKey) throw new Error('OpenAI not configured');

    const startedAt = Date.now();
    const client = new OpenAI({ apiKey });
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...(req.systemPrompt
        ? [{ role: 'system' as const, content: req.systemPrompt }]
        : []),
      ...(req.messages?.length
        ? req.messages.map((message) => ({
            role: message.role,
            content: message.content,
          }))
        : []),
      {
        role: 'user' as const,
        content: req.messages?.length ? req.prompt : this.buildPrompt(req),
      },
    ];
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
    });

    return {
      text: response.choices[0]?.message?.content ?? '',
      provider: 'openai',
      tokensUsed: response.usage?.total_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  }

  private async callGemini(req: AIRequest): Promise<AIResponse> {
    const apiKey = this.config.get<string>('ai.googleKey');
    if (!apiKey) throw new Error('Gemini not configured');

    const startedAt = Date.now();
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: 'gemini-1.5-pro' });
    const response = await model.generateContent(this.buildGeminiPrompt(req));

    return {
      text: response.response.text(),
      provider: 'gemini',
      tokensUsed: 0,
      latencyMs: Date.now() - startedAt,
    };
  }

  private async callClaude(req: AIRequest): Promise<AIResponse> {
    const apiKey = this.config.get<string>('ai.anthropicKey');
    if (!apiKey) throw new Error('Claude not configured');

    const startedAt = Date.now();
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
      ...(req.systemPrompt ? { system: req.systemPrompt } : {}),
      messages: this.buildClaudeMessages(req),
    });
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => ('text' in block ? block.text : ''))
      .join('');

    return {
      text,
      provider: 'claude',
      tokensUsed:
        (response.usage?.input_tokens ?? 0) +
        (response.usage?.output_tokens ?? 0),
      latencyMs: Date.now() - startedAt,
    };
  }

  private buildPrompt(req: AIRequest): string {
    const context = req.context
      ? `\n\nContext:\n${JSON.stringify(req.context, null, 2)}`
      : '';
    return req.systemPrompt
      ? `${req.systemPrompt}\n\n${req.prompt}${context}`
      : `${req.prompt}${context}`;
  }

  private buildGeminiPrompt(req: AIRequest): string {
    if (!req.messages?.length) return this.buildPrompt(req);
    const history = req.messages
      .map((message) => `${this.formatRole(message)}: ${message.content}`)
      .join('\n');
    return `${history}\nUser: ${req.prompt}`;
  }

  private buildClaudeMessages(
    req: AIRequest,
  ): Anthropic.Messages.MessageParam[] {
    if (!req.messages?.length) {
      return [{ role: 'user', content: this.buildPrompt(req) }];
    }
    return [
      ...req.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      { role: 'user' as const, content: req.prompt },
    ];
  }

  private formatRole(message: ConversationMessage): 'User' | 'Assistant' {
    return message.role === 'user' ? 'User' : 'Assistant';
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timeout: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`Timeout after ${ms}ms`)),
        ms,
      );
    });
    return Promise.race([promise, timeoutPromise]).finally(() =>
      clearTimeout(timeout),
    );
  }
}
