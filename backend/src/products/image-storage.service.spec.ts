import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config/app-config';
import { ImageStorageService, sniffImageExtension } from './image-storage.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

describe('sniffImageExtension', () => {
  it('detects by content, not by name', () => {
    expect(sniffImageExtension(PNG)).toBe('.png');
    expect(sniffImageExtension(JPEG)).toBe('.jpg');
    expect(sniffImageExtension(WEBP)).toBe('.webp');
    expect(sniffImageExtension(Buffer.from('<?php echo 1; ?>'))).toBeNull();
    expect(sniffImageExtension(Buffer.alloc(0))).toBeNull();
  });
});

describe('ImageStorageService', () => {
  let dir: string;
  let storage: ImageStorageService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pd-uploads-'));
    storage = new ImageStorageService({
      ...loadConfig({ JWT_SECRET: 'x'.repeat(32) }),
      uploadDir: dir,
    });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes valid images under random names and returns public URLs', async () => {
    const [url] = await storage.save([{ buffer: PNG, originalname: 'evil.exe', size: PNG.length }]);
    expect(url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    expect(readFileSync(join(dir, url.split('/').pop() as string))).toEqual(PNG);
  });

  it('rejects the whole batch if any file is not an image, writing nothing', async () => {
    await expect(
      storage.save([
        { buffer: PNG, originalname: 'a.png', size: PNG.length },
        { buffer: Buffer.from('nope'), originalname: 'b.png', size: 4 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('removes only its own uploads', async () => {
    const [url] = await storage.save([{ buffer: JPEG, originalname: 'a.jpg', size: JPEG.length }]);
    await storage.remove([url, 'https://example.com/x.jpg']);
    expect(existsSync(join(dir, url.split('/').pop() as string))).toBe(false);
  });
});
