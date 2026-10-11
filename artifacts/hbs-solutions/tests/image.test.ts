import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPRESS_OVER_BYTES, MAX_SIDE, compressImage, isRasterImage, jpegName, shouldCompress, targetSize } from '../src/lib/image';

// Fake files: only the fields the decision logic reads. Canvas work needs a
// browser, so compressImage is only checked for the paths that skip it.
const fake = (name: string, type: string, size: number) => ({ name, type, size });
const MB = 1024 * 1024;

test('only JPEG and PNG are candidates, by type or by extension', () => {
  assert.equal(isRasterImage(fake('a.jpg', 'image/jpeg', 1)), true);
  assert.equal(isRasterImage(fake('a.PNG', '', 1)), true);
  assert.equal(isRasterImage(fake('scan.pdf', 'application/pdf', 1)), false);
  assert.equal(isRasterImage(fake('a.heic', 'image/heic', 1)), false);
});

test('a photo is compressed when heavier than 1.5 MB or wider than 2000 px, never a PDF', () => {
  assert.equal(COMPRESS_OVER_BYTES, 1.5 * MB);
  assert.equal(shouldCompress(fake('a.jpg', 'image/jpeg', 1.5 * MB), 1200, 1600), false, 'small enough on both counts');
  assert.equal(shouldCompress(fake('a.jpg', 'image/jpeg', 1.5 * MB + 1), 1200, 1600), true, 'over the byte limit');
  assert.equal(shouldCompress(fake('a.png', 'image/png', 200 * 1024), 2001, 100), true, 'over the pixel limit');
  assert.equal(shouldCompress(fake('a.png', 'image/png', 200 * 1024), 100, 2000), false, 'exactly 2000 px is fine');
  assert.equal(shouldCompress(fake('big.pdf', 'application/pdf', 9 * MB), 5000, 5000), false);
});

test('the longest side is capped at 2000 px with the ratio kept, and nothing is upscaled', () => {
  assert.equal(MAX_SIDE, 2000);
  assert.deepEqual(targetSize(4000, 3000), { width: 2000, height: 1500 });
  assert.deepEqual(targetSize(3000, 4000), { width: 1500, height: 2000 });
  assert.deepEqual(targetSize(640, 480), { width: 640, height: 480 });
  assert.deepEqual(targetSize(2000, 2000), { width: 2000, height: 2000 });
  assert.deepEqual(targetSize(10000, 1), { width: 2000, height: 1 });
});

test('the original name is kept with a .jpg extension', () => {
  assert.equal(jpegName('إقامة.png'), 'إقامة.jpg');
  assert.equal(jpegName('IMG_0001.JPEG'), 'IMG_0001.jpg');
  assert.equal(jpegName('photo'), 'photo.jpg');
  assert.equal(jpegName('.png'), 'photo.jpg');
});

test('outside a browser, or for a PDF, the original file comes back unchanged', async () => {
  const pdf = fake('scan.pdf', 'application/pdf', 9 * MB) as unknown as File;
  assert.equal(await compressImage(pdf), pdf);
  const jpg = fake('a.jpg', 'image/jpeg', 9 * MB) as unknown as File;
  assert.equal(await compressImage(jpg), jpg, 'no document/canvas here: upload the original rather than fail');
});
