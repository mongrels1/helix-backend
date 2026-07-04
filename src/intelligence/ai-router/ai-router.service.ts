import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { EmailService } from '../../modules/email/email.service';
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
  private readonly providerChain: AIProvider[] = ['claude', 'openai', 'gemini'];
  private lastAlertAt = 0;
  private readonly alertCooldownMs = 15 * 60 * 1000;

  constructor(
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  async chat(req: AIRequest): Promise<AIResponse> {
    const providers = this.getProviderOrder(req.preferredProvider);
    const failures: string[] = [];

    for (const provider of providers) {
      try {
        const response = await this.withTimeout(
          this.callProvider(provider, req),
          req.timeoutMs ?? this.timeoutMs,
        );
        this.logger.log(
          `AI provider=${response.provider} latencyMs=${response.latencyMs} tokens=${response.tokensUsed}`,
        );
        return response;
      } catch (error) {
        const reason = String(error);
        failures.push(`${provider}: ${reason}`);
        this.logger.warn(`AI provider ${provider} failed: ${reason}`);
      }
    }

    this.logger.error(
      `All AI providers failed (${providers.join(', ')}). ${failures.join(' | ')}`,
    );
    void this.alertAllProvidersDown(failures);
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

  private async alertAllProvidersDown(failures: string[]): Promise<void> {
    const now = Date.now();
    if (now - this.lastAlertAt < this.alertCooldownMs) return;
    this.lastAlertAt = now;
    const quotaHit = failures.some((f) =>
      /429|quota|billing|insufficient/i.test(f),
    );
    const subject = quotaHit
      ? '[Helix] AI quota exhausted - all providers down'
      : '[Helix] AI service down - all providers failing';
    const body =
      `All AI providers failed at ${new Date(now).toISOString()}. ` +
      `Failures: ${failures.join(' | ')}.` +
      (quotaHit
        ? ' Likely cause: provider quota/billing exhausted - add credits or confirm a funded fallback provider key.'
        : '');
    try {
      await this.email.sendAdminAlert(subject, body);
    } catch (err) {
      this.logger.error(`Failed to send AI alert email: ${String(err)}`);
    }
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
      model: 'claude-haiku-4-5-20251001',
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

  /**
   * Claude-only vision call. Used by the CRA figure-extraction pass: given a
   * rendered PDF page (base64 PNG/JPEG) plus a text prompt, returns the model's
   * text (expected to be a JSON array of figure specs). Deliberately OUTSIDE the
   * openai/gemini fallback chain — figure extraction is a batch, admin-only
   * operation where we want Claude's vision specifically, not a silent fallback.
   * Vision-capable model; can be upgraded to a stronger model for higher fidelity.
   */
  async claudeVision(opts: {
    text: string;
    images: { base64: string; mediaType: string }[];
    systemPrompt?: string;
    maxTokens?: number;
    timeoutMs?: number;
    model?: string;
  }): Promise<string> {
    const apiKey = this.config.get<string>('ai.anthropicKey');
    if (!apiKey) throw new Error('Claude not configured');
    const client = new Anthropic({ apiKey });
    const content: Anthropic.Messages.ContentBlockParam[] = [
      ...opts.images.map(
        (img): Anthropic.Messages.ContentBlockParam => ({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType as
              | 'image/png'
              | 'image/jpeg'
              | 'image/gif'
              | 'image/webp',
            data: img.base64,
          },
        }),
      ),
      { type: 'text', text: opts.text },
    ];
    const fallback = 'claude-haiku-4-5-20251001';
    const run = (model: string) =>
      this.withTimeout(
        client.messages.create({
          model,
          max_tokens: opts.maxTokens ?? 4000,
          temperature: 0,
          ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
          messages: [{ role: 'user', content }],
        }),
        opts.timeoutMs ?? 60_000,
      );
    const wanted = opts.model ?? fallback;
    let response;
    try {
      response = await run(wanted);
    } catch (err) {
      // If the requested (e.g. top-tier) model isn't enabled on the key, don't let
      // the whole vision pass silently fail — fall back to the known-good model.
      if (wanted === fallback) throw err;
      this.logger.warn(`claudeVision model ${wanted} failed (${String(err)}); retrying with ${fallback}`);
      response = await run(fallback);
    }
    return response.content
      .filter((block) => block.type === 'text')
      .map((block) => ('text' in block ? block.text : ''))
      .join('');
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
