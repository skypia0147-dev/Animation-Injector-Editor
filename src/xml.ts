import {tr} from './i18n/korean.ts';
export type Xml = {name: string; attrs: Record<string, string>; children: Xml[]};
export const node = (name: string, attrs: Record<string, unknown> = {}, children: Xml[] = []): Xml => ({
  name,
  attrs: Object.fromEntries(
    Object.entries(attrs)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)])
  ),
  children,
});
const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
export function printXml(n: Xml, depth = 0): string {
  const attrs = Object.entries(n.attrs)
      .map(([k, v]) => ` ${k}="${esc(v)}"`)
      .join(''),
    pad = '  '.repeat(depth);
  return (
    pad +
    '<' +
    n.name +
    attrs +
    (n.children.length
      ? '>\n' + n.children.map(c => printXml(c, depth + 1)).join('\n') + '\n' + pad + '</' + n.name + '>'
      : '/>')
  );
}
export const documentXml = (n: Xml) => '<?xml version="1.0" encoding="utf-8"?>\n' + printXml(n) + '\n';
export function parseXml(text: string): Xml {
  if (text.length > 2_000_000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
    throw new Error(tr('XML 크기 제한 또는 잘못된 제어 문자입니다.'));
  text = text.replace(/^\uFEFF/, '');
  let i = 0,
    count = 0;
  const stack: Xml[] = [],
    roots: Xml[] = [];
  const fail = () => {
    throw new Error(tr('XML 문법 오류 또는 지원하지 않는 선언: 위치 ') + i);
  };
  const decode = (s: string) =>
    s.replace(/&([^;]*);|&/g, (_whole, key) => {
      const named: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
      if (Object.hasOwn(named, key)) return named[key];
      if (/^#(?:x[\da-f]+|\d+)$/i.test(key ?? '')) {
        const v = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        if (
          v === 9 ||
          v === 10 ||
          v === 13 ||
          (v >= 32 && v <= 0x10ffff && !(v >= 0xd800 && v <= 0xdfff) && v !== 0xfffe && v !== 0xffff)
        )
          return String.fromCodePoint(v);
      }
      return fail();
    });
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0 || text.slice(i + 4, end).includes('--')) fail();
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?xml', i) && !roots.length && !stack.length && i === 0) {
      // The desktop backend hands over UTF-16 files already decoded (code review E-9).
      // `standalone` as other tools write it; the runtime (pugixml) reads past the declaration (10-28 review E-22).
      const m =
        /^<\?xml\s+version=['"]1\.0['"](?:\s+encoding=['"]utf-(?:8|16)['"])?(?:\s+standalone=['"](?:yes|no)['"])?\s*\?>/i.exec(
          text.slice(i)
        );
      if (!m) fail();
      i += m![0].length;
      continue;
    }
    if (text.startsWith('</', i)) {
      const m = /^<\/([A-Za-z][\w-]*)\s*>/.exec(text.slice(i));
      if (!m || stack.pop()?.name !== m[1]) fail();
      i += m![0].length;
      continue;
    }
    const m = /^<([A-Za-z][\w-]*)/.exec(text.slice(i));
    if (!m || ++count > 20000 || stack.length > 32) fail();
    i += m![0].length;
    const n = node(m![1]);
    while (true) {
      const tail = text.slice(i);
      const end = /^\s*(\/?>)/.exec(tail);
      if (end) {
        i += end[0].length;
        if (stack.length) stack.at(-1)!.children.push(n);
        else roots.push(n);
        if (end[1] === '>') stack.push(n);
        break;
      }
      const a = /^\s+([A-Za-z][\w-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(tail);
      if (!a || Object.hasOwn(n.attrs, a[1])) fail();
      n.attrs[a![1]] = decode(a![2] ?? a![3]);
      i += a![0].length;
    }
  }
  if (stack.length || roots.length !== 1) fail();
  return roots[0];
}
export function shapeXml(n: Xml, attrs: string[], children: string[] = []) {
  for (const k of Object.keys(n.attrs))
    if (!attrs.includes(k)) throw new Error(tr('{name}.{k}: 가져오기를 지원하지 않는 속성입니다.', {name: n.name, k}));
  for (const c of n.children)
    if (!children.includes(c.name))
      throw new Error(tr('{name}/{name1}: 가져오기를 지원하지 않는 요소입니다.', {name: n.name, name1: c.name}));
}
export function one(n: Xml, name: string): Xml | undefined {
  const found = n.children.filter(c => c.name === name);
  if (found.length > 1) throw new Error(tr('{name}/{name1}: 중복 요소입니다.', {name: n.name, name1: name}));
  return found[0];
}
