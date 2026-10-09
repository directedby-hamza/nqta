import { createRequire } from 'node:module';
import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from '@zxing/library';
import { describe, expect, it } from 'vitest';
import { checkoutQRSource } from '../../src/features/card/save-card';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs') as {
  PNG: { sync: { read: (value: Buffer) => { width: number; height: number; data: Buffer } } };
};

describe('downloadable checkout QR', () => {
  it('produces a real PNG whose decoded payload is only the opaque checkout code', async () => {
    const url = await checkoutQRSource('NQ-0123456789ABCDEF');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const image = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
    const luminance = new Uint8ClampedArray(image.width * image.height);
    for (let pixel = 0; pixel < luminance.length; pixel++) {
      const offset = pixel * 4;
      luminance[pixel] =
        (image.data[offset] + 2 * image.data[offset + 1] + image.data[offset + 2]) / 4;
    }
    const decoded = new QRCodeReader().decode(
      new BinaryBitmap(
        new HybridBinarizer(new RGBLuminanceSource(luminance, image.width, image.height)),
      ),
      new Map([[DecodeHintType.PURE_BARCODE, true]]),
    );
    expect(decoded.getText()).toBe('NQ-0123456789ABCDEF');
  });

  it.each([
    '',
    'Unavailable',
    'NQ-1234',
    'https://nqta.example/card/private?session=secret',
    'customer@example.com',
    '212600000000',
  ])('refuses %j instead of exporting another account identifier', async (value) => {
    await expect(checkoutQRSource(value)).rejects.toThrow('Checkout code unavailable');
  });
});
