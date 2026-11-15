import { Fragment } from 'react';

/** Лёгкий рендер Markdown заметок: **жирный**, *курсив*, [[ссылки между заметками]], #теги, абзацы. Без HTML — безопасно. */
export function Markdown({ text, onLink }: { text: string; onLink?: (target: string) => void }) {
  const inline = (line: string, key: number) => {
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|\[\[[^\]]+\]\]|(?<=^|\s)#[\p{L}\d_-]{2,30})/gu);
    return (
      <Fragment key={key}>
        {parts.map((p, i) => {
          if (/^\*\*.+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
          if (/^\*.+\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
          if (/^\[\[.+\]\]$/.test(p)) {
            const target = p.slice(2, -2);
            return onLink
              ? <button key={i} type="button" className="underline underline-offset-2" onClick={(e) => { e.stopPropagation(); onLink(target); }}>{target}</button>
              : <span key={i} className="underline underline-offset-2">{target}</span>;
          }
          if (/^#[\p{L}\d_-]+$/u.test(p)) return <span key={i} className="font-mono text-[0.85em] opacity-80">{p}</span>;
          return <Fragment key={i}>{p}</Fragment>;
        })}
      </Fragment>
    );
  };
  return (
    <>
      {text.split(/\n{2,}/).map((block, b) => (
        <p key={b} className="mb-2 last:mb-0">
          {block.split('\n').map((line, l, arr) => <Fragment key={l}>{inline(line, l)}{l < arr.length - 1 && <br />}</Fragment>)}
        </p>
      ))}
    </>
  );
}
