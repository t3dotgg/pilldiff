import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svgSource = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });

try {
  const page = await browser.newPage();

  async function renderPng(size: number, background?: string): Promise<Buffer> {
    const dataUrl = await page.evaluate(async ({ svgSource, size, background }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgSource)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Cannot create a canvas for favicon rendering.');
      if (background) {
        context.fillStyle = background;
        context.fillRect(0, 0, size, size);
      }
      context.drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png');
    }, { svgSource, size, background });
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  }

  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map((size) => renderPng(size)));
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let imageOffset = directory.length;

  for (const [index, image] of images.entries()) {
    const entryOffset = 6 + index * 16;
    directory.writeUInt8(sizes[index], entryOffset);
    directory.writeUInt8(sizes[index], entryOffset + 1);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(image.length, entryOffset + 8);
    directory.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += image.length;
  }

  const touchIcon = await renderPng(180, '#111113');
  await writeFile(new URL('../public/favicon.ico', import.meta.url), Buffer.concat([directory, ...images]));
  await writeFile(new URL('../public/apple-touch-icon.png', import.meta.url), touchIcon);
  console.log('Generated 16/32/48 px favicon frames and a 180 px touch icon from public/favicon.svg.');
} finally {
  await browser.close();
}
