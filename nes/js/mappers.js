/* iNES cart + mappers 0, 1, 2, 3, 4, 7. */
(function (g) {
  "use strict";

  const NAMES = { 0: "NROM", 1: "MMC1", 2: "UNROM", 3: "CNROM", 4: "MMC3", 7: "AxROM" };

  function Cart(bytes) {
    if (bytes.length < 16 || bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53) {
      throw new Error("Not an iNES ROM");
    }
    this.prgBanks = bytes[4];
    this.chrBanks = bytes[5];
    this.flags6 = bytes[6];
    this.flags7 = bytes[7];
    this.mapperId = ((this.flags7 & 0xf0) | (this.flags6 >> 4)) & 0xff;
    if ((this.flags7 & 0x0c) === 0x08) {
      this.mapperId |= (bytes[8] & 0x0f) << 8;
    }
    this.mirrorFlag = this.flags6 & 1; // 0 horiz, 1 vert
    this.fourScreen = !!(this.flags6 & 8);
    this.battery = !!(this.flags6 & 2);
    this.hasTrainer = !!(this.flags6 & 4);
    let off = 16;
    if (this.hasTrainer) off += 512;
    const prgSize = this.prgBanks * 16384;
    const chrSize = this.chrBanks * 8192;
    this.prg = bytes.slice(off, off + prgSize);
    off += prgSize;
    if (chrSize) this.chr = bytes.slice(off, off + chrSize);
    else this.chr = new Uint8Array(8192); // CHR RAM
    this.chrRam = this.chrBanks === 0;
    this.prgRam = new Uint8Array(8192);
    this.name = (NAMES[this.mapperId] || ("MAP" + this.mapperId));
  }

  function applyMirror(ppu, cart, extra) {
    if (cart.fourScreen) ppu.mirroring = 2;
    else if (extra === 0 || extra === 1) ppu.mirroring = extra;
    else if (extra === 2) ppu.mirroring = 3;
    else if (extra === 3) ppu.mirroring = 4;
    else ppu.mirroring = cart.mirrorFlag;
  }

  function Mapper0(nes, cart) {
    this.nes = nes; this.cart = cart;
  }
  Mapper0.prototype.cpuRead = function (addr) {
    if (addr >= 0x8000) {
      const mask = this.cart.prg.length - 1;
      return this.cart.prg[(addr - 0x8000) & mask];
    }
    if (addr >= 0x6000) return this.cart.prgRam[addr - 0x6000];
    return 0;
  };
  Mapper0.prototype.cpuWrite = function (addr, val) {
    if (addr >= 0x6000 && addr < 0x8000) this.cart.prgRam[addr - 0x6000] = val;
  };
  Mapper0.prototype.ppuRead = function (addr) { return this.cart.chr[addr & 0x1fff]; };
  Mapper0.prototype.ppuWrite = function (addr, val) {
    if (this.cart.chrRam) this.cart.chr[addr & 0x1fff] = val;
  };

  function Mapper1(nes, cart) {
    this.nes = nes; this.cart = cart;
    this.shift = 0x10;
    this.ctrl = 0x0c;
    this.chr0 = 0; this.chr1 = 0; this.prg = 0;
    this.lastWrite = 0;
  }
  Mapper1.prototype._bank = function () {
    const mode = (this.ctrl >> 2) & 3;
    const prg = this.prg & 0x0f;
    const banks = this.cart.prg.length / 16384;
    this._prgMode = mode;
    this._prgBank = prg % Math.max(banks, 1);
    this._chrMode = (this.ctrl >> 4) & 1;
    this._chr0 = this.chr0;
    this._chr1 = this.chr1;
    const mir = this.ctrl & 3;
    // 0 one-screen lower, 1 one-screen upper, 2 vert, 3 horiz
    const map = { 0: 3, 1: 4, 2: 1, 3: 0 };
    applyMirror(this.nes.ppu, this.cart, map[mir]);
  };
  Mapper1.prototype.cpuRead = function (addr) {
    if (addr < 0x8000) {
      if (addr >= 0x6000) return this.cart.prgRam[addr - 0x6000];
      return 0;
    }
    const banks = this.cart.prg.length / 16384;
    const mode = (this.ctrl >> 2) & 3;
    const b = this.prg % Math.max(banks, 1);
    let bank;
    if (mode === 0 || mode === 1) {
      bank = (b & 0xfe) % Math.max(banks, 1);
      const off = addr - 0x8000;
      return this.cart.prg[(bank * 16384 + off) % this.cart.prg.length];
    }
    if (mode === 2) {
      if (addr < 0xc000) return this.cart.prg[addr - 0x8000];
      return this.cart.prg[(b * 16384 + (addr - 0xc000)) % this.cart.prg.length];
    }
    if (addr < 0xc000) return this.cart.prg[(b * 16384 + (addr - 0x8000)) % this.cart.prg.length];
    return this.cart.prg[((banks - 1) * 16384 + (addr - 0xc000)) % this.cart.prg.length];
  };
  Mapper1.prototype.cpuWrite = function (addr, val) {
    if (addr >= 0x6000 && addr < 0x8000) { this.cart.prgRam[addr - 0x6000] = val; return; }
    if (addr < 0x8000) return;
    if (val & 0x80) { this.shift = 0x10; this.ctrl |= 0x0c; return; }
    const complete = this.shift & 1;
    this.shift = (this.shift >> 1) | ((val & 1) << 4);
    if (!complete) return;
    const data = this.shift & 0x1f;
    this.shift = 0x10;
    if (addr < 0xa000) this.ctrl = data;
    else if (addr < 0xc000) this.chr0 = data;
    else if (addr < 0xe000) this.chr1 = data;
    else this.prg = data;
    this._bank();
  };
  Mapper1.prototype.ppuRead = function (addr) {
    addr &= 0x1fff;
    const chr = this.cart.chr;
    if (this.ctrl & 0x10) {
      const b = (addr < 0x1000 ? this.chr0 : this.chr1) * 4096;
      return chr[(b + (addr & 0xfff)) % chr.length];
    }
    return chr[(((this.chr0 & 0x1e) * 4096) + addr) % chr.length];
  };
  Mapper1.prototype.ppuWrite = function (addr, val) {
    if (!this.cart.chrRam) return;
    addr &= 0x1fff;
    this.cart.chr[addr] = val;
  };

  function Mapper2(nes, cart) {
    this.nes = nes; this.cart = cart; this.bank = 0;
  }
  Mapper2.prototype.cpuRead = function (addr) {
    if (addr < 0x8000) return addr >= 0x6000 ? this.cart.prgRam[addr - 0x6000] : 0;
    const banks = this.cart.prg.length / 16384;
    if (addr < 0xc000) {
      return this.cart.prg[((this.bank % banks) * 16384) + (addr - 0x8000)];
    }
    return this.cart.prg[((banks - 1) * 16384) + (addr - 0xc000)];
  };
  Mapper2.prototype.cpuWrite = function (addr, val) {
    if (addr >= 0x6000 && addr < 0x8000) this.cart.prgRam[addr - 0x6000] = val;
    else if (addr >= 0x8000) this.bank = val & 0x0f;
  };
  Mapper2.prototype.ppuRead = function (a) { return this.cart.chr[a & 0x1fff]; };
  Mapper2.prototype.ppuWrite = function (a, v) { if (this.cart.chrRam) this.cart.chr[a & 0x1fff] = v; };

  function Mapper3(nes, cart) {
    this.nes = nes; this.cart = cart; this.bank = 0;
  }
  Mapper3.prototype.cpuRead = function (addr) {
    if (addr >= 0x8000) return this.cart.prg[(addr - 0x8000) % this.cart.prg.length];
    if (addr >= 0x6000) return this.cart.prgRam[addr - 0x6000];
    return 0;
  };
  Mapper3.prototype.cpuWrite = function (addr, val) {
    if (addr >= 0x6000 && addr < 0x8000) this.cart.prgRam[addr - 0x6000] = val;
    else if (addr >= 0x8000) this.bank = val & 3;
  };
  Mapper3.prototype.ppuRead = function (addr) {
    return this.cart.chr[(this.bank * 8192 + (addr & 0x1fff)) % this.cart.chr.length];
  };
  Mapper3.prototype.ppuWrite = function (a, v) { if (this.cart.chrRam) this.cart.chr[a & 0x1fff] = v; };

  function Mapper4(nes, cart) {
    this.nes = nes; this.cart = cart;
    this.bankSel = 0;
    this.banks = new Uint8Array(8);
    this.prgMode = 0;
    this.chrMode = 0;
    this.irqLatch = 0;
    this.irqReload = false;
    this.irqCounter = 0;
    this.irqEnabled = false;
    this.mirr = cart.mirrorFlag;
  }
  Mapper4.prototype.scanline = function () {
    if (this.irqCounter === 0 || this.irqReload) {
      this.irqCounter = this.irqLatch;
      this.irqReload = false;
    } else this.irqCounter--;
    if (this.irqCounter === 0 && this.irqEnabled) this.nes.cpu.irq = true;
  };
  Mapper4.prototype._prgOff = function (slot) {
    const n = this.cart.prg.length / 8192;
    const last = n - 1, last2 = n - 2;
    const b = this.banks;
    let bank;
    if (this.prgMode === 0) {
      bank = [b[6], b[7], last2, last][slot];
    } else {
      bank = [last2, b[7], b[6], last][slot];
    }
    return ((bank & (n - 1)) * 8192);
  };
  Mapper4.prototype._chrOff = function (slot2k) {
    const n = Math.max(this.cart.chr.length / 1024, 1);
    const b = this.banks;
    let map;
    if (!this.chrMode) map = [b[0] & 0xfe, (b[0] & 0xfe) + 1, b[1] & 0xfe, (b[1] & 0xfe) + 1, b[2], b[3], b[4], b[5]];
    else map = [b[2], b[3], b[4], b[5], b[0] & 0xfe, (b[0] & 0xfe) + 1, b[1] & 0xfe, (b[1] & 0xfe) + 1];
    return (map[slot2k] & (n - 1)) * 1024;
  };
  Mapper4.prototype.cpuRead = function (addr) {
    if (addr < 0x8000) return addr >= 0x6000 ? this.cart.prgRam[addr - 0x6000] : 0;
    const slot = (addr - 0x8000) >> 13;
    return this.cart.prg[this._prgOff(slot) + (addr & 0x1fff)];
  };
  Mapper4.prototype.cpuWrite = function (addr, val) {
    if (addr >= 0x6000 && addr < 0x8000) { this.cart.prgRam[addr - 0x6000] = val; return; }
    if (addr < 0x8000) return;
    if (addr < 0xa000) {
      if ((addr & 1) === 0) {
        this.bankSel = val & 7;
        this.prgMode = (val >> 6) & 1;
        this.chrMode = (val >> 7) & 1;
      } else this.banks[this.bankSel] = val;
    } else if (addr < 0xc000) {
      if ((addr & 1) === 0 && !this.cart.fourScreen) {
        applyMirror(this.nes.ppu, this.cart, (val & 1) ? 0 : 1);
      }
    } else if (addr < 0xe000) {
      if ((addr & 1) === 0) this.irqLatch = val;
      else { this.irqReload = true; }
    } else {
      if ((addr & 1) === 0) { this.irqEnabled = false; this.nes.cpu.irq = false; }
      else this.irqEnabled = true;
    }
  };
  Mapper4.prototype.ppuRead = function (addr) {
    addr &= 0x1fff;
    const slot = addr >> 10;
    return this.cart.chr[(this._chrOff(slot) + (addr & 0x3ff)) % this.cart.chr.length];
  };
  Mapper4.prototype.ppuWrite = function (addr, val) {
    if (!this.cart.chrRam) return;
    addr &= 0x1fff;
    const slot = addr >> 10;
    this.cart.chr[(this._chrOff(slot) + (addr & 0x3ff)) % this.cart.chr.length] = val;
  };

  function Mapper7(nes, cart) {
    this.nes = nes; this.cart = cart; this.bank = 0;
  }
  Mapper7.prototype.cpuRead = function (addr) {
    if (addr < 0x8000) return addr >= 0x6000 ? this.cart.prgRam[addr - 0x6000] : 0;
    const banks = this.cart.prg.length / 32768;
    const b = this.bank % Math.max(banks, 1);
    return this.cart.prg[b * 32768 + (addr - 0x8000)];
  };
  Mapper7.prototype.cpuWrite = function (addr, val) {
    if (addr >= 0x6000 && addr < 0x8000) { this.cart.prgRam[addr - 0x6000] = val; return; }
    if (addr >= 0x8000) {
      this.bank = val & 7;
      applyMirror(this.nes.ppu, this.cart, (val & 0x10) ? 4 : 3);
    }
  };
  Mapper7.prototype.ppuRead = function (a) { return this.cart.chr[a & 0x1fff]; };
  Mapper7.prototype.ppuWrite = function (a, v) { if (this.cart.chrRam) this.cart.chr[a & 0x1fff] = v; };

  function createMapper(nes, cart) {
    applyMirror(nes.ppu, cart, cart.mirrorFlag);
    switch (cart.mapperId) {
      case 0: return new Mapper0(nes, cart);
      case 1: return new Mapper1(nes, cart);
      case 2: return new Mapper2(nes, cart);
      case 3: return new Mapper3(nes, cart);
      case 4: return new Mapper4(nes, cart);
      case 7: return new Mapper7(nes, cart);
      default:
        console.warn("Unsupported mapper", cart.mapperId, "— using NROM fallback");
        return new Mapper0(nes, cart);
    }
  }

  g.NesCart = Cart;
  g.NesCreateMapper = createMapper;
  g.NES_MAPPER_NAMES = NAMES;
})(typeof window !== "undefined" ? window : globalThis);
