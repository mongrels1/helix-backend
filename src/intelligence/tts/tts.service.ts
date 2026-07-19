import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

/**
 * EdKairos · TtsService
 * Premium cloud text-to-speech via ElevenLabs, used for the on-demand
 * "Read to me" / "Hear this picture" narration (EdKairos methodology §3.7).
 *
 * Design:
 *  - Key-gated: with no ELEVENLABS_API_KEY set, this throws 503 and the frontend
 *    falls back to the free browser voice — so deploying is a no-op until the key
 *    is added, then it flips everyone to the premium voice. Safe rollout.
 *  - Cached: an in-memory LRU keyed by (voice, model, text) means repeated plays
 *    of the same reply or the same fixed item stem don't re-synthesize — the main
 *    cost control. (A persistent cache in R2/DB can layer on later for fixed
 *    content that must survive restarts.)
 *  - Bounded: per-request character cap keeps latency and cost predictable.
 *  - Model/voice are env-configurable; default is Flash v2.5 (best cost/latency).
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly cache = new Map<string, Buffer>();
  private readonly MAX_CACHE = 500;
  private readonly MAX_CHARS = 800;

  constructor(private readonly config: ConfigService) {}

  private key(text: string, voice: string, model: string): string {
    return createHash('sha1').update(`${voice}:${model}:${text}`).digest('hex');
  }

  async synthesize(rawText: string): Promise<Buffer> {
    const apiKey = this.config.get<string>('elevenlabs.apiKey') ?? '';
    if (!apiKey) throw new ServiceUnavailableException('tts_not_configured');

    const text = (rawText ?? '').trim();
    if (!text) throw new BadRequestException('empty_text');
    const clipped = text.length > this.MAX_CHARS ? text.slice(0, this.MAX_CHARS) : text;

    const voiceId =
      this.config.get<string>('elevenlabs.voiceId') || '21m00Tcm4TlvDq8ikWAM';
    const model =
      this.config.get<string>('elevenlabs.model') || 'eleven_flash_v2_5';
    const cacheKey = this.key(clipped, voiceId, model);

    const cached = this.cache.get(cacheKey);
    if (cached) {
      // refresh recency (LRU)
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached;
    }

    // Use global fetch (Node 18+) without pulling in DOM lib types.
    type FetchLike = (
      input: string,
      init?: unknown,
    ) => Promise<{
      ok: boolean;
      status: number;
      text: () => Promise<string>;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>;
    const doFetch = (globalThis as unknown as { fetch: FetchLike }).fetch;
    if (typeof doFetch !== 'function') {
      throw new ServiceUnavailableException('tts_unavailable');
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: clipped,
          model_id: model,
          voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.15 },
        }),
      });
    } catch (err) {
      this.logger.error(`ElevenLabs request failed: ${String(err)}`);
      throw new ServiceUnavailableException('tts_upstream_error');
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
      throw new ServiceUnavailableException('tts_upstream_error');
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (this.cache.size >= this.MAX_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(cacheKey, buf);
    return buf;
  }
}
