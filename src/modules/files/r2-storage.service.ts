import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name);
  private client: S3Client | null = null;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const accountId = config.get<string>('r2.accountId');
    const accessKeyId = config.get<string>('r2.accessKeyId');
    const secretAccessKey = config.get<string>('r2.secretAccessKey');
    this.bucket = config.get<string>('r2.bucketName') ?? 'helix-files';

    if (accountId && accessKeyId && secretAccessKey) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
    } else {
      this.logger.warn('R2 credentials not configured - using mock storage');
    }
  }

  async getPresignedUploadUrl(
    key: string,
    mimeType: string,
    expiresIn = 3600,
  ): Promise<string> {
    if (!this.client) {
      return `https://mock-r2.example.com/upload/${key}?mock=true`;
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
      });
      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (error) {
      this.logger.warn(`R2 presign failed - using mock URL: ${String(error)}`);
      return `https://mock-r2.example.com/upload/${key}?mock=true`;
    }
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.client) {
      this.logger.warn(`[MOCK R2] delete: ${key}`);
      return;
    }

    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      this.logger.warn(`R2 delete failed: ${String(error)}`);
    }
  }

  getPublicUrl(key: string): string {
    const publicUrl = this.config.get<string>('r2.publicUrl');
    if (!publicUrl) return `https://mock-r2.example.com/${key}`;
    return `${publicUrl}/${key}`;
  }
}
