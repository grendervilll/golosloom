// Генерация иконки приложения (простой PNG без внешних зависимостей).
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const SIZE = 1024
const R = 88
const G = 101
const B = 242

// Рисуем скруглённый квадрат с буквой "G"-подобным пятном.
function pixel(x, y) {
  const cx = SIZE / 2
  const cy = SIZE / 2
  const dx = x - cx
  const dy = y - cy
  const radius = SIZE * 0.42
  const inside = dx * dx + dy * dy <= radius * radius
  if (!inside) return [0, 0, 0, 0]
  // Тёмная полоса-"волна" снизу, имитирующая звуковую волну.
  const wave = Math.sin(dx / 60) * 18
  if (dy > 40 && dy < 90 + wave) return [255, 255, 255, 255]
  return [R, G, B, 255]
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b, a] = pixel(x, y)
    const off = y * (SIZE * 4 + 1) + 1 + x * 4
    raw[off] = r
    raw[off + 1] = g
    raw[off + 2] = b
    raw[off + 3] = a
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

const outDir = path.join(__dirname, 'src-tauri', 'icons')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'icon-source.png'), png)
console.log('icon-source.png created:', png.length, 'bytes')
