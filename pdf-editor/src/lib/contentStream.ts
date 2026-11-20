/**
 * A small, binary-safe PDF content stream tokenizer/parser.
 *
 * Streams are handled as "binary strings" (one JS char per byte, 0-255) so the
 * original bytes of untouched operators can be copied verbatim when rewriting.
 */

export type Operand =
  | { type: 'num'; value: number }
  | { type: 'name'; value: string }
  | { type: 'str'; value: string; hex: boolean }
  | { type: 'arr'; items: Operand[] }
  | { type: 'dict'; entries: Map<string, Operand> }
  | { type: 'kw'; value: string };

export interface ContentOp {
  op: string;
  args: Operand[];
  /** Byte offset of the first operand (or the operator when there are none). */
  start: number;
  /** Byte offset just past the operator (or past `EI` for inline images). */
  end: number;
  /** Raw image data for inline images (`BI ... ID <data> EI`). */
  inlineData?: string;
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

export function bytesToBinaryString(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

export function binaryStringToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

class Lexer {
  pos = 0;
  constructor(readonly src: string) {}

  private code(i = this.pos): number {
    return this.src.charCodeAt(i);
  }

  skipWhitespaceAndComments(): void {
    const n = this.src.length;
    while (this.pos < n) {
      const c = this.code();
      if (WHITESPACE.has(c)) {
        this.pos++;
      } else if (c === 0x25) {
        while (this.pos < n && this.code() !== 0x0a && this.code() !== 0x0d) this.pos++;
      } else {
        break;
      }
    }
  }

  atEnd(): boolean {
    this.skipWhitespaceAndComments();
    return this.pos >= this.src.length;
  }

  /** Reads the next token; returns an operand, an operator keyword, or a structural marker. */
  next(): Operand | { type: 'op'; value: string } | { type: 'close'; value: string } | null {
    this.skipWhitespaceAndComments();
    if (this.pos >= this.src.length) return null;
    const c = this.src[this.pos];
    if (c === '(') return this.readLiteralString();
    if (c === '<') {
      if (this.src[this.pos + 1] === '<') {
        this.pos += 2;
        return this.readDict();
      }
      return this.readHexString();
    }
    if (c === '>' && this.src[this.pos + 1] === '>') {
      this.pos += 2;
      return { type: 'close', value: '>>' };
    }
    if (c === '[') {
      this.pos++;
      return this.readArray();
    }
    if (c === ']') {
      this.pos++;
      return { type: 'close', value: ']' };
    }
    if (c === '/') return this.readName();
    if (c === '{' || c === '}' || c === ')' || c === '>') {
      this.pos++;
      return { type: 'kw', value: c };
    }
    const word = this.readRegular();
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { type: 'num', value: parseFloat(word) };
    if (/^[+-]?\d*\.?\d*$/.test(word) && word.length > 0 && /\d/.test(word)) {
      return { type: 'num', value: parseFloat(word) || 0 };
    }
    if (word === 'true' || word === 'false' || word === 'null') return { type: 'kw', value: word };
    return { type: 'op', value: word };
  }

  private readRegular(): string {
    const startPos = this.pos;
    const n = this.src.length;
    while (this.pos < n) {
      const c = this.code();
      if (WHITESPACE.has(c) || DELIMITERS.has(c)) break;
      this.pos++;
    }
    if (this.pos === startPos) this.pos++;
    return this.src.slice(startPos, this.pos);
  }

  private readName(): Operand {
    this.pos++;
    const raw = this.readRegularAllowEmpty();
    const value = raw.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    return { type: 'name', value };
  }

  private readRegularAllowEmpty(): string {
    const startPos = this.pos;
    const n = this.src.length;
    while (this.pos < n) {
      const c = this.code();
      if (WHITESPACE.has(c) || DELIMITERS.has(c)) break;
      this.pos++;
    }
    return this.src.slice(startPos, this.pos);
  }

  private readLiteralString(): Operand {
    this.pos++;
    let depth = 1;
    let out = '';
    const n = this.src.length;
    while (this.pos < n) {
      const ch = this.src[this.pos++];
      if (ch === '\\') {
        const e = this.src[this.pos++];
        switch (e) {
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case '(': out += '('; break;
          case ')': out += ')'; break;
          case '\\': out += '\\'; break;
          case '\r':
            if (this.src[this.pos] === '\n') this.pos++;
            break;
          case '\n':
            break;
          default:
            if (e !== undefined && e >= '0' && e <= '7') {
              let oct = e;
              for (let k = 0; k < 2 && this.src[this.pos] >= '0' && this.src[this.pos] <= '7'; k++) {
                oct += this.src[this.pos++];
              }
              out += String.fromCharCode(parseInt(oct, 8) & 0xff);
            } else if (e !== undefined) {
              out += e;
            }
        }
      } else if (ch === '(') {
        depth++;
        out += ch;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) break;
        out += ch;
      } else {
        out += ch;
      }
    }
    return { type: 'str', value: out, hex: false };
  }

  private readHexString(): Operand {
    this.pos++;
    let hex = '';
    const n = this.src.length;
    while (this.pos < n && this.src[this.pos] !== '>') {
      const ch = this.src[this.pos++];
      if (/[0-9a-fA-F]/.test(ch)) hex += ch;
    }
    this.pos++;
    if (hex.length % 2 === 1) hex += '0';
    let out = '';
    for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    return { type: 'str', value: out, hex: true };
  }

  private readArray(): Operand {
    const items: Operand[] = [];
    for (;;) {
      const t = this.next();
      if (t === null) break;
      if (t.type === 'close') {
        if (t.value === ']') break;
        continue;
      }
      if (t.type === 'op') {
        items.push({ type: 'kw', value: t.value });
        continue;
      }
      items.push(t);
    }
    return { type: 'arr', items };
  }

  private readDict(): Operand {
    const entries = new Map<string, Operand>();
    let key: string | null = null;
    for (;;) {
      const t = this.next();
      if (t === null) break;
      if (t.type === 'close') {
        if (t.value === '>>') break;
        continue;
      }
      const operand: Operand = t.type === 'op' ? { type: 'kw', value: t.value } : t;
      if (key === null) {
        if (operand.type === 'name') key = operand.value;
      } else {
        entries.set(key, operand);
        key = null;
      }
    }
    return { type: 'dict', entries };
  }

  /** After `ID`, consume raw inline image bytes up to the `EI` operator. */
  readInlineImageData(): string {
    // Exactly one whitespace byte follows ID.
    if (WHITESPACE.has(this.code())) this.pos++;
    const dataStart = this.pos;
    const n = this.src.length;
    let i = this.pos;
    while (i < n - 1) {
      if (
        this.src[i] === 'E' &&
        this.src[i + 1] === 'I' &&
        (i === dataStart || WHITESPACE.has(this.code(i - 1))) &&
        (i + 2 >= n || WHITESPACE.has(this.code(i + 2)) || DELIMITERS.has(this.code(i + 2)))
      ) {
        const data = this.src.slice(dataStart, i > dataStart ? i - 1 : i);
        this.pos = i + 2;
        return data;
      }
      i++;
    }
    this.pos = n;
    return this.src.slice(dataStart);
  }
}

/** Parses a decoded content stream into a flat list of operators with their byte spans. */
export function parseContentStream(src: string): ContentOp[] {
  const lexer = new Lexer(src);
  const ops: ContentOp[] = [];
  let args: Operand[] = [];
  let argsStart = -1;
  for (;;) {
    lexer.skipWhitespaceAndComments();
    const tokenStart = lexer.pos;
    const t = lexer.next();
    if (t === null) break;
    if (t.type === 'close') continue;
    if (t.type === 'op') {
      const start = argsStart >= 0 ? argsStart : tokenStart;
      if (t.value === 'BI') {
        // Inline image: dictionary entries until ID, then binary data until EI.
        const entries = new Map<string, Operand>();
        let key: string | null = null;
        for (;;) {
          const it = lexer.next();
          if (it === null) break;
          if (it.type === 'op' && it.value === 'ID') break;
          if (it.type === 'close' || it.type === 'op') continue;
          if (key === null && it.type === 'name') key = it.value;
          else if (key !== null) {
            entries.set(key, it);
            key = null;
          }
        }
        const data = lexer.readInlineImageData();
        ops.push({ op: 'BI', args: [{ type: 'dict', entries }], start, end: lexer.pos, inlineData: data });
      } else {
        ops.push({ op: t.value, args, start, end: lexer.pos });
      }
      args = [];
      argsStart = -1;
      continue;
    }
    if (argsStart < 0) argsStart = tokenStart;
    args.push(t);
  }
  return ops;
}

/** Serializes a byte string as a PDF hex string, e.g. `<48656C6C6F>`. */
export function toHexString(bytes: string): string {
  let out = '<';
  for (let i = 0; i < bytes.length; i++) out += bytes.charCodeAt(i).toString(16).padStart(2, '0');
  return out + '>';
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
}
