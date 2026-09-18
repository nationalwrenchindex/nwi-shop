// Builds public/favicon.ico from public/favicon.svg.
//
//   node scripts/build-favicon.mjs
//
// Run it after editing public/favicon.svg. The .ico is a build artifact of that
// file and is committed, so this script exists to keep the two from drifting —
// without it the .ico is an opaque binary nobody can regenerate.
//
// TWO ARTWORKS, BY SIZE. The full "NWI" wordmark is three glyphs, and three
// glyphs do not survive a 16x16 grid: they blur into one orange block. The tab
// slot is exactly that size, so 16px gets a single bold N instead, and 32/48 get
// the wordmark. An ICO is a container of independent images, so carrying
// different artwork per size is normal and costs nothing.
//
// In practice most people never see the 16px image: browsers prefer the SVG when
// it is offered, and a HiDPI display asks for 32px to fill a 16px slot. The N is
// for the cases that genuinely get 16 physical pixels.
//
// PNG payloads rather than the older BMP/DIB form: every browser since IE11
// reads PNG-in-ICO, alpha survives without an AND mask, and the file stays ~2 KB.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'public', 'favicon.svg')
const OUT = join(ROOT, 'public', 'favicon.ico')

/**
 * The 16px mark: one N, drawn to the same rules as the wordmark in
 * public/favicon.svg — stroked geometry rather than <text>, so it needs no font
 * to rasterise. With only one glyph to place it can run far heavier (stroke 7 vs
 * 4) and taller (cap height 32 vs 26), which is exactly what survives at 16px.
 */
const MARK_16 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0a1628"/>
  <path d="M23.5 48 V16 L40.5 48 V16"
        fill="none" stroke="#FF6600" stroke-width="7"
        stroke-linecap="butt" stroke-linejoin="miter"/>
</svg>`

/** size -> the SVG source rendered at that size. */
const PLAN = [
  { size: 16, svg: Buffer.from(MARK_16), label: 'N mark' },
  { size: 32, svg: readFileSync(SRC), label: 'NWI wordmark' },
  { size: 48, svg: readFileSync(SRC), label: 'NWI wordmark' },
]

const ENTRY_BYTES = 16

async function main() {
  const images = []
  for (const { size, svg, label } of PLAN) {
    // `density` lifts the SVG rasterisation resolution before the resize, so a
    // small icon comes out of a downsampled high-res render rather than a
    // blocky native-size one.
    const buf = await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer()
    images.push({ size, buf })
    console.log(`  ${String(size).padStart(2)}x${size}  ${String(buf.length).padStart(4)} bytes  ${label}`)
  }

  // ICONDIR: reserved(2)=0, type(2)=1 (icon), image count(2)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let offset = header.length + ENTRY_BYTES * images.length
  const entries = images.map(({ size, buf }) => {
    const e = Buffer.alloc(ENTRY_BYTES)
    e.writeUInt8(size >= 256 ? 0 : size, 0)  // width, 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1)  // height
    e.writeUInt8(0, 2)                       // palette entries, 0 for truecolour
    e.writeUInt8(0, 3)                       // reserved, must be 0
    e.writeUInt16LE(1, 4)                    // colour planes
    e.writeUInt16LE(32, 6)                   // bits per pixel
    e.writeUInt32LE(buf.length, 8)           // size of the image data
    e.writeUInt32LE(offset, 12)              // offset of the image data
    offset += buf.length
    return e
  })

  const ico = Buffer.concat([header, ...entries, ...images.map((i) => i.buf)])
  writeFileSync(OUT, ico)
  console.log(`\nwrote public/favicon.ico  ${ico.length} bytes`)
}

main().catch((err) => {
  console.error(`favicon build failed: ${err.message}`)
  process.exit(1)
})
