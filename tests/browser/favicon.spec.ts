import { expect, test } from '@playwright/test';
import { playlistPath } from '../../src/navigation';
import { collectionPlaylist } from './catalog-fixture';
import { installAppHarness } from './harness';

test('uses root-relative production icons on the home page and direct playlist links', async ({ page }) => {
  await installAppHarness(page);

  for (const path of ['/', playlistPath(collectionPlaylist.id)]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/playlists\//);
    await expect(page.locator('link[rel="icon"]')).toHaveCount(2);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg');
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('sizes', 'any');
    await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveAttribute('sizes', '16x16 32x32 48x48');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('sizes', '180x180');
  }
});

test('serves the approved Blackletter B and decodable raster icons in every advertised size', async ({ page, request }) => {
  const svgResponse = await request.get('/favicon.svg');
  expect(svgResponse.ok()).toBe(true);
  expect(svgResponse.headers()['content-type']).toContain('image/svg+xml');
  const svg = await svgResponse.text();
  const proposal = await (await request.get('/proposals/favicons/01-blackletter.svg')).text();
  expect(svg.replace(/<title>.*?<\/title>/, '')).toBe(proposal.replace(/<title>.*?<\/title>/, ''));
  expect(svg).not.toContain('proposal');

  const icoResponse = await request.get('/favicon.ico');
  expect(icoResponse.ok()).toBe(true);
  expect(icoResponse.headers()['content-type']).toMatch(/image\/(?:x-icon|vnd\.microsoft\.icon)/);
  const icon = await icoResponse.body();
  expect(icon.readUInt16LE(0)).toBe(0);
  expect(icon.readUInt16LE(2)).toBe(1);
  expect(icon.readUInt16LE(4)).toBe(3);
  const iconDimensions = await page.evaluate(async (encodedIcon) => {
    const image = new Image();
    image.src = `data:image/x-icon;base64,${encodedIcon}`;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, icon.toString('base64'));
  expect([16, 32, 48]).toContain(iconDimensions.width);
  expect(iconDimensions.height).toBe(iconDimensions.width);
  const frames = [];
  let expectedOffset = 6 + 3 * 16;

  for (const [index, size] of [16, 32, 48].entries()) {
    const entryOffset = 6 + index * 16;
    expect(icon.readUInt8(entryOffset)).toBe(size);
    expect(icon.readUInt8(entryOffset + 1)).toBe(size);
    expect(icon.readUInt16LE(entryOffset + 4)).toBe(1);
    expect(icon.readUInt16LE(entryOffset + 6)).toBe(32);
    const length = icon.readUInt32LE(entryOffset + 8);
    const offset = icon.readUInt32LE(entryOffset + 12);
    expect(offset).toBe(expectedOffset);
    frames.push({ size, png: icon.subarray(offset, offset + length).toString('base64') });
    expectedOffset += length;
  }
  expect(icon.length).toBe(expectedOffset);

  const touchResponse = await request.get('/apple-touch-icon.png');
  expect(touchResponse.ok()).toBe(true);
  expect(touchResponse.headers()['content-type']).toContain('image/png');
  frames.push({ size: 180, png: (await touchResponse.body()).toString('base64') });

  for (const frame of frames) {
    const rendered = await page.evaluate(async ({ png }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        corner: Array.from(pixels.slice(0, 4)),
        opaque: pixels.every((channel, index) => index % 4 !== 3 || channel === 255),
        hasArtwork: pixels.some((channel, index) => index % 4 === 0 && channel > 200),
      };
    }, frame);
    expect(rendered.width).toBe(frame.size);
    expect(rendered.height).toBe(frame.size);
    expect(rendered.hasArtwork).toBe(true);
    if (frame.size === 180) {
      expect(rendered.opaque).toBe(true);
      expect(rendered.corner).toEqual([17, 17, 19, 255]);
    }
  }
});
