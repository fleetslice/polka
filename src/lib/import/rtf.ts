/** Минимальный разбор RTF в текст: абзацы, юникод (\uN), \'hh в кодовой странице документа. */
const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'footnote', 'object', 'themedata', 'datastore', 'generator', 'listtable', 'listoverridetable', 'rsidtbl', 'xmlnstbl', 'latentstyles']);

export function rtfToText(src: string): string {
  const cp = Number(src.match(/\\ansicpg(\d+)/)?.[1] ?? 1251);
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(`windows-${cp}`);
  } catch {
    decoder = new TextDecoder('windows-1251');
  }
  let out = '';
  let i = 0;
  let depth = 0;
  let skipDepth = -1;
  let ucSkip = 1;
  let pendingSkip = 0;
  const bytes: number[] = [];
  const flush = (): void => {
    if (bytes.length) {
      out += decoder.decode(new Uint8Array(bytes));
      bytes.length = 0;
    }
  };
  const emit = (s: string): void => {
    if (skipDepth >= 0) return;
    flush();
    out += s;
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '{') {
      depth += 1;
      i += 1;
    } else if (ch === '}') {
      if (skipDepth === depth) skipDepth = -1;
      depth -= 1;
      i += 1;
    } else if (ch === '\\') {
      const next = src[i + 1] ?? '';
      if (next === "'") {
        const byte = parseInt(src.slice(i + 2, i + 4), 16);
        i += 4;
        if (pendingSkip > 0) pendingSkip -= 1;
        else if (skipDepth < 0 && !Number.isNaN(byte)) bytes.push(byte);
      } else if (next === '*') {
        if (skipDepth < 0) skipDepth = depth;
        i += 2;
      } else if (/[\\{}]/.test(next)) {
        emit(next);
        i += 2;
      } else if (next === '~') {
        emit(' ');
        i += 2;
      } else if (next === '\n' || next === '\r') {
        emit('\n');
        i += 2;
      } else {
        const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i, i + 40));
        if (!m) {
          i += 2;
          continue;
        }
        i += m[0].length;
        const word = m[1]!;
        const num = m[2] !== undefined ? Number(m[2]) : undefined;
        if (SKIP.has(word) && skipDepth < 0) skipDepth = depth;
        else if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') emit('\n');
        else if (word === 'tab') emit('\t');
        else if (word === 'uc' && num !== undefined) ucSkip = num;
        else if (word === 'u' && num !== undefined) {
          emit(String.fromCharCode(num < 0 ? num + 65536 : num));
          pendingSkip = ucSkip;
        } else if (word === 'emdash') emit('—');
        else if (word === 'endash') emit('–');
        else if (word === 'lquote') emit('‘');
        else if (word === 'rquote') emit('’');
        else if (word === 'ldblquote') emit('“');
        else if (word === 'rdblquote') emit('”');
        else if (word === 'bullet') emit('•');
      }
    } else if (ch === '\r' || ch === '\n') {
      i += 1;
    } else {
      if (pendingSkip > 0) pendingSkip -= 1;
      else emit(ch);
      i += 1;
    }
  }
  flush();
  // В RTF каждый \par — абзац: разделяем пустой строкой, чтобы сработало определение заголовков.
  return out.split('\n').map((l) => l.trim()).join('\n\n');
}
