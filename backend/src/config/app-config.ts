export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  jwtExpiresInSeconds: number;
  orderPaymentTtlSeconds: number;
  orderSweepIntervalMs: number;
  uploadDir: string;
  corsOrigin: string[];
  adminUsername?: string;
  adminPassword?: string;
  seedDemo: boolean;
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`Environment variable ${key} must be an integer >= ${min}, got "${raw}"`);
  }
  return value;
}

/**
 * Reads and validates configuration from the environment. Fails fast at boot
 * rather than at the first request that needs a missing value.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 16) {
    throw new Error('JWT_SECRET must be set and at least 16 characters long');
  }
  if (nodeEnv === 'production' && jwtSecret.startsWith('change-me')) {
    throw new Error('Refusing to start in production with the example JWT_SECRET');
  }

  return {
    nodeEnv,
    port: int(env, 'PORT', 3000, 1),
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/prime_deals',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379/0',
    jwtSecret,
    jwtExpiresInSeconds: int(env, 'JWT_EXPIRES_IN_SECONDS', 7200, 60),
    orderPaymentTtlSeconds: int(env, 'ORDER_PAYMENT_TTL_SECONDS', 900, 1),
    orderSweepIntervalMs: int(env, 'ORDER_SWEEP_INTERVAL_MS', 60_000, 100),
    uploadDir: env.UPLOAD_DIR ?? './uploads',
    corsOrigin: (env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    adminUsername: env.ADMIN_USERNAME || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
    seedDemo: env.SEED_DEMO === 'true',
  };
}
