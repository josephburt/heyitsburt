/* NTSC PPU — scanline renderer with loopy scrolling, sprites, sprite-0. */
(function (g) {
  "use strict";

  function rgb(r, g, b) { return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0; }
  const PALETTE_RGB = new Uint32Array([
    rgb(0x62,0x62,0x62), rgb(0x00,0x1f,0xb2), rgb(0x24,0x00,0xb8), rgb(0x52,0x00,0xa2), rgb(0x73,0x00,0x3d), rgb(0x73,0x00,0x00), rgb(0x64,0x10,0x00), rgb(0x3c,0x28,0x00),
    rgb(0x00,0x3c,0x00), rgb(0x00,0x44,0x00), rgb(0x00,0x3c,0x10), rgb(0x00,0x30,0x5a), rgb(0,0,0), rgb(0,0,0), rgb(0,0,0), rgb(0,0,0),
    rgb(0xab,0xab,0xab), rgb(0x00,0x59,0xf6), rgb(0x2f,0x2f,0xff), rgb(0x7a,0x14,0xf6), rgb(0xab,0x00,0x79), rgb(0xb7,0x00,0x0e), rgb(0xac,0x2c,0x00), rgb(0x8b,0x4e,0x00),
    rgb(0x55,0x62,0x00), rgb(0x1d,0x76,0x00), rgb(0x00,0x7c,0x00), rgb(0x00,0x76,0x5a), rgb(0x00,0x5c,0x9a), rgb(0,0,0), rgb(0,0,0), rgb(0,0,0),
    rgb(0xff,0xff,0xff), rgb(0x4f,0xb0,0xff), rgb(0x81,0x87,0xff), rgb(0xc3,0x5b,0xff), rgb(0xf4,0x5a,0xff), rgb(0xff,0x5d,0x7f), rgb(0xff,0x77,0x57), rgb(0xff,0x9f,0x2f),
    rgb(0xf3,0xc0,0x00), rgb(0x97,0xe3,0x00), rgb(0x54,0xf1,0x64), rgb(0x1e,0xf2,0xb0), rgb(0x29,0xd4,0xff), rgb(0x4c,0x4c,0x4c), rgb(0,0,0), rgb(0,0,0),
    rgb(0xff,0xff,0xff), rgb(0xb6,0xe1,0xff), rgb(0xc8,0xcb,0xff), rgb(0xe3,0xbe,0xff), rgb(0xf8,0xbd,0xff), rgb(0xff,0xc0,0xd4), rgb(0xff,0xc6,0xb8), rgb(0xff,0xd5,0xa8),
    rgb(0xff,0xe1,0x94), rgb(0xd3,0xf4,0x9a), rgb(0xb5,0xf9,0xb8), rgb(0xa8,0xf8,0xd8), rgb(0xa8,0xe6,0xff), rgb(0xb8,0xb8,0xb8), rgb(0,0,0), rgb(0,0,0)
  ]);

  function PPU(nes) {
    this.nes = nes;
    this.vram = new Uint8Array(0x800);
    this.palette = new Uint8Array(32);
    this.oam = new Uint8Array(256);
    this.secOam = new Uint8Array(32);
    this.pixels = new Uint32Array(256 * 240);
    this.frameReady = false;

    this.ctrl = 0;
    this.mask = 0;
    this.status = 0;
    this.oamAddr = 0;
    this.v = 0;
    this.t = 0;
    this.x = 0;
    this.w = 0;
    this.buf = 0;
    this.scanline = 261;
    this.dot = 0;
    this.nmiDelay = 0;
    this.frameOdd = false;
    this.sprite0This = false;
    this.mirroring = 0; // 0 horiz, 1 vert, 2 four, 3 single0, 4 single1
    this._slV = 0;
    this._slX = 0;
  }

  PPU.prototype.reset = function () {
    this.ctrl = this.mask = this.status = 0;
    this.oamAddr = 0;
    this.v = this.t = this.x = this.w = 0;
    this.buf = 0;
    this.scanline = 261;
    this.dot = 0;
    this.nmiDelay = 0;
    this.frameOdd = false;
    this.frameReady = false;
    this.pixels.fill(0xff000000);
    this.oam.fill(0xff);
  };

  PPU.prototype.rendering = function () { return (this.mask & 0x18) !== 0; };

  PPU.prototype.ntMirror = function (addr) {
    addr &= 0x0fff;
    const table = addr >> 10;
    const off = addr & 0x3ff;
    let t = table;
    switch (this.mirroring) {
      case 0: t = table & 1; break;          // horizontal (a/a/b/b) — vertical arrangement of tables
      case 1: t = table >> 1; break;         // vertical   (a/b/a/b)
      case 2: t = table; return this.nes.mapper.ppuRead(0x2000 + addr); // four-screen via cart
      case 3: t = 0; break;
      case 4: t = 1; break;
      default: t = table & 1; break;
    }
    // Standard NES:
    // Horizontal mirroring: $2000=$2400, $2800=$2C00  → table 0,1 ->0  and 2,3 ->1
    // Vertical mirroring:   $2000=$2800, $2400=$2C00  → table 0,2 ->0  and 1,3 ->1
    if (this.mirroring === 0) t = table < 2 ? 0 : 1; // horizontal
    if (this.mirroring === 1) t = table & 1;         // vertical
    return this.vram[(t << 10) | off];
  };

  PPU.prototype.ntWrite = function (addr, val) {
    addr &= 0x0fff;
    const table = addr >> 10;
    const off = addr & 0x3ff;
    let t = 0;
    if (this.mirroring === 0) t = table < 2 ? 0 : 1;
    else if (this.mirroring === 1) t = table & 1;
    else if (this.mirroring === 3) t = 0;
    else if (this.mirroring === 4) t = 1;
    else {
      this.nes.mapper.ppuWrite(0x2000 + addr, val);
      return;
    }
    this.vram[(t << 10) | off] = val;
  };

  PPU.prototype.palRead = function (addr) {
    addr &= 0x1f;
    if ((addr & 0x13) === 0x10) addr &= 0x0f;
    return this.palette[addr];
  };
  PPU.prototype.palWrite = function (addr, val) {
    addr &= 0x1f;
    val &= 0x3f;
    if ((addr & 0x13) === 0x10) addr &= 0x0f;
    this.palette[addr] = val;
  };

  PPU.prototype.ppuRead = function (addr) {
    addr &= 0x3fff;
    if (addr < 0x2000) return this.nes.mapper.ppuRead(addr);
    if (addr < 0x3f00) return this.ntMirror(addr);
    return this.palRead(addr);
  };
  PPU.prototype.ppuWrite = function (addr, val) {
    addr &= 0x3fff;
    val &= 0xff;
    if (addr < 0x2000) { this.nes.mapper.ppuWrite(addr, val); return; }
    if (addr < 0x3f00) { this.ntWrite(addr, val); return; }
    this.palWrite(addr, val);
  };

  PPU.prototype.readReg = function (reg) {
    switch (reg & 7) {
      case 2: {
        const r = (this.status & 0xe0) | (this.buf & 0x1f);
        this.status &= ~0x80;
        this.w = 0;
        return r;
      }
      case 4: return this.oam[this.oamAddr];
      case 7: {
        let val = this.buf;
        this.buf = this.ppuRead(this.v);
        if ((this.v & 0x3fff) >= 0x3f00) val = this.buf;
        this.v = (this.v + ((this.ctrl & 0x04) ? 32 : 1)) & 0x7fff;
        return val;
      }
      default: return this.buf;
    }
  };

  PPU.prototype.writeReg = function (reg, val) {
    this.buf = val;
    switch (reg & 7) {
      case 0:
        this.ctrl = val;
        this.t = (this.t & 0xf3ff) | ((val & 3) << 10);
        break;
      case 1:
        this.mask = val;
        break;
      case 3:
        this.oamAddr = val;
        break;
      case 4:
        this.oam[this.oamAddr] = val;
        this.oamAddr = (this.oamAddr + 1) & 0xff;
        break;
      case 5:
        if (!this.w) {
          this.t = (this.t & 0xffe0) | (val >> 3);
          this.x = val & 7;
          this.w = 1;
        } else {
          this.t = (this.t & 0x8c1f) | ((val & 0xf8) << 2) | ((val & 7) << 12);
          this.w = 0;
        }
        break;
      case 6:
        if (!this.w) {
          this.t = (this.t & 0x00ff) | ((val & 0x3f) << 8);
          this.w = 1;
        } else {
          this.t = (this.t & 0xff00) | val;
          this.v = this.t;
          this.w = 0;
        }
        break;
      case 7:
        this.ppuWrite(this.v, val);
        this.v = (this.v + ((this.ctrl & 0x04) ? 32 : 1)) & 0x7fff;
        break;
    }
  };

  PPU.prototype.incX = function () {
    if ((this.v & 0x001f) === 31) {
      this.v &= ~0x001f;
      this.v ^= 0x0400;
    } else this.v++;
  };
  PPU.prototype.incY = function () {
    if ((this.v & 0x7000) !== 0x7000) this.v += 0x1000;
    else {
      this.v &= ~0x7000;
      let y = (this.v & 0x03e0) >> 5;
      if (y === 29) { y = 0; this.v ^= 0x0800; }
      else if (y === 31) y = 0;
      else y++;
      this.v = (this.v & ~0x03e0) | (y << 5);
    }
  };
  PPU.prototype.copyX = function () { this.v = (this.v & ~0x041f) | (this.t & 0x041f); };
  PPU.prototype.copyY = function () { this.v = (this.v & ~0x7be0) | (this.t & 0x7be0); };

  PPU.prototype.bgPixel = function (x) {
    if (!(this.mask & 0x08)) return 0;
    if (x < 8 && !(this.mask & 0x02)) return 0;
    const fx = (x + this.x) & 7;
    // reconstruct coarse from v as it stands at start of scanline after copyX
    // We snapshot fine-x + v at scanline start in _slV
    const v = this._slV;
    const fineX = this._slX;
    const px = x + fineX;
    const coarseX = ((v & 0x1f) + (px >> 3)) & 0xff;
    let nt = (v & 0x0c00);
    let cx = (v & 0x1f) + (px >> 3);
    if (cx >= 32) { cx -= 32; nt ^= 0x0400; }
    const cy = (v >> 5) & 0x1f;
    const fineY = (v >> 12) & 7;
    const naddr = 0x2000 | nt | (cy << 5) | (cx & 0x1f);
    const tile = this.ntMirror(naddr);
    const attrAddr = 0x23c0 | nt | ((cy >> 2) << 3) | ((cx & 0x1f) >> 2);
    const attr = this.ntMirror(attrAddr);
    const shift = ((cy & 2) << 1) | (cx & 2);
    const pal = (attr >> shift) & 3;
    const pt = ((this.ctrl & 0x10) ? 0x1000 : 0) + tile * 16 + fineY;
    const p0 = this.nes.mapper.ppuRead(pt);
    const p1 = this.nes.mapper.ppuRead(pt + 8);
    const bit = 7 - (px & 7);
    const lo = (p0 >> bit) & 1;
    const hi = (p1 >> bit) & 1;
    const c = lo | (hi << 1);
    if (!c) return 0;
    return (pal << 2) | c;
  };

  PPU.prototype.evalSprites = function (scan) {
    const h = (this.ctrl & 0x20) ? 16 : 8;
    this.secOam.fill(0xff);
    this.sprite0This = false;
    let n = 0;
    for (let i = 0; i < 64; i++) {
      const y = this.oam[i * 4];
      const row = scan - y;
      if (row < 0 || row >= h) continue;
      if (n < 8) {
        if (i === 0) this.sprite0This = true;
        this.secOam[n * 4] = y;
        this.secOam[n * 4 + 1] = this.oam[i * 4 + 1];
        this.secOam[n * 4 + 2] = this.oam[i * 4 + 2];
        this.secOam[n * 4 + 3] = this.oam[i * 4 + 3];
      }
      n++;
    }
    if (n > 8) this.status |= 0x20;
  };

  PPU.prototype.spritePixel = function (x) {
    if (!(this.mask & 0x10)) return { c: 0, pri: 1, s0: false };
    if (x < 8 && !(this.mask & 0x04)) return { c: 0, pri: 1, s0: false };
    const h = (this.ctrl & 0x20) ? 16 : 8;
    for (let i = 0; i < 8; i++) {
      const y = this.secOam[i * 4];
      if (y === 0xff && this.secOam[i * 4 + 1] === 0xff) continue;
      const tile = this.secOam[i * 4 + 1];
      const attr = this.secOam[i * 4 + 2];
      const sx = this.secOam[i * 4 + 3];
      const col = x - sx;
      if (col < 0 || col > 7) continue;
      let row = this.scanline - y;
      if (row < 0 || row >= h) continue;
      if (attr & 0x80) row = h - 1 - row;
      let t = tile;
      let ptBase;
      if (h === 16) {
        ptBase = (t & 1) * 0x1000;
        t = (t & 0xfe) + (row >= 8 ? 1 : 0);
        row &= 7;
      } else {
        ptBase = (this.ctrl & 0x08) ? 0x1000 : 0;
      }
      const flipX = attr & 0x40;
      const bit = flipX ? col : (7 - col);
      const pt = ptBase + t * 16 + row;
      const p0 = this.nes.mapper.ppuRead(pt);
      const p1 = this.nes.mapper.ppuRead(pt + 8);
      const lo = (p0 >> bit) & 1;
      const hi = (p1 >> bit) & 1;
      const pix = lo | (hi << 1);
      if (!pix) continue;
      return {
        c: 0x10 | ((attr & 3) << 2) | pix,
        pri: (attr >> 5) & 1,
        s0: this.sprite0This && i === 0
      };
    }
    return { c: 0, pri: 1, s0: false };
  };

  PPU.prototype.renderScanline = function () {
    if (this.scanline < 0 || this.scanline > 239) return;
    this._slV = this.v;
    this._slX = this.x;
    this.evalSprites(this.scanline);
    const row = this.scanline * 256;
    for (let x = 0; x < 256; x++) {
      const bg = this.bgPixel(x);
      const sp = this.spritePixel(x);
      let idx;
      if (!bg) idx = sp.c ? sp.c : 0;
      else if (!sp.c) idx = bg;
      else {
        if (sp.s0 && bg & 3) this.status |= 0x40;
        idx = sp.pri ? bg : sp.c;
      }
      const pal = this.palRead(idx) & 0x3f;
      this.pixels[row + x] = PALETTE_RGB[pal];
    }
  };

  PPU.prototype.tick = function () {
    if (this.nmiDelay > 0) {
      this.nmiDelay--;
      if (this.nmiDelay === 0 && (this.status & 0x80) && (this.ctrl & 0x80)) {
        this.nes.cpu.triggerNmi();
      }
    }

    const sl = this.scanline;
    const d = this.dot;
    const rend = this.rendering();

    if (sl === 241 && d === 1) {
      this.status |= 0x80;
      this.frameReady = true;
      if (this.ctrl & 0x80) this.nmiDelay = 2;
    }

    if (sl === 261 && d === 1) {
      this.status &= ~0xe0;
    }

    if (rend) {
      if ((sl < 240 || sl === 261) && d === 0) {
        this._slV = this.v;
        this._slX = this.x;
      }
      if (sl < 240 && d === 256) this.incY();
      if ((sl < 240 || sl === 261) && d === 257) this.copyX();
      if (sl === 261 && d >= 280 && d <= 304) this.copyY();
    }

    if (sl < 240 && d === 260 && rend) {
      if (this.nes.mapper.scanline) this.nes.mapper.scanline();
    }
    if (sl === 261 && d === 260 && rend) {
      if (this.nes.mapper.scanline) this.nes.mapper.scanline();
    }

    this.dot++;
    if (this.dot > 340) {
      if (sl < 240) this.renderScanline();
      this.dot = 0;
      this.scanline++;
      if (this.scanline > 261) {
        this.scanline = 0;
        if (rend) this.frameOdd = !this.frameOdd;
        else this.frameOdd = false;
      }
      if (this.rendering() && this.scanline < 240) {
        this._slV = this.v;
        this._slX = this.x;
      }
    }
  };

  PPU.prototype.step = function (cpuCycles) {
    const n = cpuCycles * 3;
    for (let i = 0; i < n; i++) this.tick();
  };

  g.NesPPU = PPU;
})(typeof window !== "undefined" ? window : globalThis);
