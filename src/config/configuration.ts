export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  database: { url: process.env.DATABASE_URL },
  redis: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    expiresIn: '15m',
    refreshExpiresIn: '7d',
  },
  ai: {
    openaiKey: process.env.OPENAI_API_KEY ?? '',
    googleKey: process.env.GOOGLE_AI_API_KEY ?? '',
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  },
  app: {
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  },
  email: {
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.EMAIL_FROM ?? 'Helix <onboarding@resend.dev>',
    alertTo: process.env.ADMIN_ALERT_EMAIL ?? '',
  },
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    bucketName: process.env.R2_BUCKET_NAME ?? 'helix-files',
    publicUrl: process.env.R2_PUBLIC_URL ?? '',
  },
});
