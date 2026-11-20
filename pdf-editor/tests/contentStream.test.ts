import { describe, expect, it } from 'vitest';
import { formatNumber, parseContentStream, toHexString } from '../src/lib/contentStream';

describe('parseContentStream', () => {
  it('parses operators with operands and byte spans', () => {
    const src = 'q 1 0 0 1 10 20 cm BT /F1 12 Tf (Hi) Tj ET Q';
    const ops = parseContentStream(src);
    expect(ops.map((o) => o.op)).toEqual(['q', 'cm', 'BT', 'Tf', 'Tj', 'ET', 'Q']);
    const cm = ops[1];
    expect(cm.args.map((a) => (a.type === 'num' ? a.value : null))).toEqual([1, 0, 0, 1, 10, 20]);
    expect(src.slice(cm.start, cm.end)).toBe('1 0 0 1 10 20 cm');
    const tj = ops[4];
    expect(src.slice(tj.start, tj.end)).toBe('(Hi) Tj');
    expect(tj.args[0]).toEqual({ type: 'str', value: 'Hi', hex: false });
  });

  it('decodes literal string escapes, nesting and hex strings', () => {
    const ops = parseContentStream('(a\\(b\\)c (nested) \\101\\n) Tj <48 65 6C6C 6F> Tj <414> Tj');
    expect(ops[0].args[0]).toMatchObject({ value: 'a(b)c (nested) A\n' });
    expect(ops[1].args[0]).toMatchObject({ value: 'Hello', hex: true });
    expect(ops[2].args[0]).toMatchObject({ value: 'A@' });
  });

  it('parses TJ arrays, names with escapes, dictionaries and comments', () => {
    const ops = parseContentStream('% comment\n[(A) -120 (B)] TJ /Na#20me gs /P <</MCID 3>> BDC EMC');
    expect(ops[0].op).toBe('TJ');
    const arr = ops[0].args[0];
    expect(arr.type).toBe('arr');
    if (arr.type === 'arr') expect(arr.items.map((i) => i.type)).toEqual(['str', 'num', 'str']);
    expect(ops[1].args[0]).toEqual({ type: 'name', value: 'Na me' });
    expect(ops[2].op).toBe('BDC');
    const dict = ops[2].args[1];
    expect(dict.type === 'dict' && dict.entries.get('MCID')).toEqual({ type: 'num', value: 3 });
  });

  it('skips binary inline image data', () => {
    const src = 'q BI /W 2 /H 1 /CS /G /BPC 8 ID \x00EI\xff EI Q';
    const ops = parseContentStream(src);
    expect(ops.map((o) => o.op)).toEqual(['q', 'BI', 'Q']);
    expect(ops[1].inlineData).toBe('\x00EI\xff');
  });

  it('handles odd numbers', () => {
    const ops = parseContentStream('.5 -3. +2 0 0 1 cm');
    expect(ops[0].args.map((a) => (a.type === 'num' ? a.value : NaN))).toEqual([0.5, -3, 2, 0, 0, 1]);
  });
});

describe('serialization helpers', () => {
  it('formats hex strings and numbers', () => {
    expect(toHexString('A\x00\xff')).toBe('<4100ff>');
    expect(formatNumber(1.234567)).toBe('1.2346');
    expect(formatNumber(-0.00001)).toBe('0');
    expect(formatNumber(NaN)).toBe('0');
  });
});
