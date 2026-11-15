/** Работа с текстовыми смещениями внутри отрисованной главы (позиция чтения, выделения). */

function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** Смещение (в символах textContent корня) для точки DOM (node, offset). */
export function textOffset(root: Node, node: Node, offset: number): number {
  if (!root.contains(node)) return -1;
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch {
    return -1;
  }
  return range.toString().length;
}

/** Точка DOM для смещения в символах. */
export function pointAt(root: Node, offset: number): { node: Text; offset: number } | null {
  let left = Math.max(0, offset);
  const nodes = textNodes(root);
  for (const n of nodes) {
    if (left <= n.length) return { node: n, offset: left };
    left -= n.length;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: last.length } : null;
}

export function rangeAt(root: Node, start: number, end: number): Range | null {
  const a = pointAt(root, start);
  const b = pointAt(root, end);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

/** Оборачивает диапазон [start, end) в <mark> — по одному на каждый затронутый текстовый узел. */
export function wrapRange(root: Node, start: number, end: number, className: string, id?: string): void {
  if (end <= start) return;
  let pos = 0;
  for (const node of textNodes(root)) {
    const len = node.length;
    const from = Math.max(start, pos);
    const to = Math.min(end, pos + len);
    if (from < to) {
      let target = node;
      if (from > pos) target = target.splitText(from - pos);
      if (to - from < target.length) target.splitText(to - from);
      const mark = document.createElement('mark');
      mark.className = className;
      if (id) mark.dataset.hl = id;
      target.parentNode?.insertBefore(mark, target);
      mark.appendChild(target);
    }
    pos += len;
    if (pos >= end) break;
  }
}

/** Смещение текста под точкой экрана; -1, если точка не попала в текст корня. */
export function offsetFromPoint(root: Node, x: number, y: number): number {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) return textOffset(root, pos.offsetNode, pos.offset);
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range) return textOffset(root, range.startContainer, range.startOffset);
  return -1;
}
