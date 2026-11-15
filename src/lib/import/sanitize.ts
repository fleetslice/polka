import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'i', 'strong', 'b', 'u', 's', 'sub', 'sup', 'small',
  'blockquote', 'cite', 'q', 'pre', 'code', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'div', 'span', 'section', 'aside',
];
const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'id', 'class', 'colspan', 'rowspan', 'data-page', 'data-note', 'lang'];

const BOOK_CLASSES = new Set(['noteref', 'epigraph', 'poem', 'stanza', 'verse', 'text-author', 'annotation', 'pg']);

let hooked = false;

/** Очищает HTML книги: без скриптов, стилей и внешних ресурсов. Картинки — только встроенные data:. */
export function sanitizeBookHtml(html: string): string {
  if (!hooked) {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      // Классы из книги не должны совпасть с классами интерфейса: оставляем только те, что ставят наши парсеры.
      const cls = (node.getAttribute('class') ?? '').split(/\s+/).filter((c) => BOOK_CLASSES.has(c));
      if (cls.length) node.setAttribute('class', cls.join(' '));
      else node.removeAttribute('class');
      if (node.tagName === 'IMG') {
        const src = node.getAttribute('src') ?? '';
        if (!/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(src)) node.remove();
        else node.setAttribute('loading', 'lazy');
      }
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') ?? '';
        if (href.startsWith('#')) return;
        if (/^https?:\/\//i.test(href)) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer nofollow');
        } else node.removeAttribute('href');
      }
    });
    hooked = true;
  }
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ADD_URI_SAFE_ATTR: ['src'],
    ALLOWED_URI_REGEXP: /^(?:https?:|#|data:image\/)/i,
  });
}

export function htmlToText(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent ?? '';
}
