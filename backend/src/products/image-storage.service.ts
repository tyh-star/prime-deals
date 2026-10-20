import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const UPLOAD_URL_PREFIX = '/uploads/';

/**
 * Detects the real image type from magic bytes. The client-supplied MIME type and
 * file extension are ignored, so a renamed script cannot be stored as an "image".
 */
export function sniffImageExtension(buf: Buffer): '.jpg' | '.png' | '.webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return '.png';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return '.webp';
  }
  return null;
}

export interface UploadedImage {
  buffer: Buffer;
  originalname: string;
  size: number;
}

@Injectable()
export class ImageStorageService {
  private readonly logger = new Logger(ImageStorageService.name);
  readonly dir: string;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.dir = resolve(cfg.uploadDir);
    mkdirSync(this.dir, { recursive: true });
  }

  /** Validates every file before writing any, then returns their public URLs. */
  async save(files: UploadedImage[] = []): Promise<string[]> {
    if (files.length > MAX_IMAGES) {
      throw new BadRequestException(`At most ${MAX_IMAGES} images are allowed`);
    }
    const prepared = files.map((file) => {
      const ext = sniffImageExtension(file.buffer);
      if (!ext) {
        throw new BadRequestException(`${file.originalname} is not a JPEG, PNG or WebP image`);
      }
      return { file, name: `${randomUUID()}${ext}` };
    });
    await Promise.all(prepared.map(({ file, name }) => writeFile(join(this.dir, name), file.buffer)));
    return prepared.map(({ name }) => `${UPLOAD_URL_PREFIX}${name}`);
  }

  /** Best-effort cleanup of images we stored; external URLs are left alone. */
  async remove(urls: string[]): Promise<void> {
    await Promise.all(
      urls
        .filter((url) => url.startsWith(UPLOAD_URL_PREFIX))
        .map((url) =>
          unlink(join(this.dir, basename(url))).catch((err: Error) =>
            this.logger.warn(`Could not delete ${url}: ${err.message}`),
          ),
        ),
    );
  }
}
