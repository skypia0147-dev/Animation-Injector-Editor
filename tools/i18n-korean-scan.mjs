// Finds the Korean text written directly in src/ (outside src/i18n) with prettier's TypeScript parser, and says how
// each one is used. `--json <file>` writes every occurrence; without it, prints a summary.
// Used to move the UI to tr() (src/i18n/korean.ts) and by tests/korean-coverage.test.mjs.
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import * as prettier from 'prettier';

const HANGUL = /[가-힣]/;
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export function sourceFiles(dir = join(root, 'src')) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'i18n') out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

const TYPE = new Set([
  'TSLiteralType',
  'TSTypeAnnotation',
  'TSTypeAliasDeclaration',
  'TSInterfaceBody',
  'TSPropertySignature',
  'TSEnumMember',
  'TSTypeParameterInstantiation',
]);
const FUNCTION = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'MethodDefinition']);

/** Every Korean literal of one file: {kind, start, end, text, context}. */
export async function scanFile(path) {
  const text = readFileSync(path, 'utf8');
  if (!HANGUL.test(text)) return [];
  const {ast} = await prettier.__debug.parse(text, {parser: 'typescript', filepath: path});
  const found = [];
  const visit = (node, parents) => {
    if (!node || typeof node.type !== 'string') return;
    const parent = parents.at(-1);
    let kind = '';
    if (node.type === 'Literal' && typeof node.value === 'string' && HANGUL.test(node.value)) kind = 'string';
    else if (node.type === 'TemplateLiteral' && node.quasis.some(q => HANGUL.test(q.value.cooked ?? '')))
      kind = 'template';
    else if (node.type === 'JSXText' && HANGUL.test(node.value)) kind = 'jsxText';
    if (kind) {
      const context = [];
      if (parents.some(p => p.type === 'ImportDeclaration' || p.type === 'ExportAllDeclaration'))
        context.push('import');
      if (parents.some(p => TYPE.has(p.type))) context.push('type');
      if (
        parent?.type === 'CallExpression' &&
        parent.callee.type === 'Identifier' &&
        ['tr', 'trPattern', 'trFragment'].includes(parent.callee.name) &&
        parent.arguments[0] === node
      )
        context.push('wrapped');
      if (parent?.type === 'Property' && parent.key === node && !parent.computed) context.push('key');
      if (parent?.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)) context.push('compare');
      if (parent?.type === 'SwitchCase' && parent.test === node) context.push('compare');
      if (parent?.type === 'JSXAttribute') context.push('attr');
      if (parent?.type === 'NewExpression' || parents.some(p => p.type === 'ThrowStatement')) context.push('error');
      if (!parents.some(p => FUNCTION.has(p.type))) context.push('module');
      found.push({
        kind,
        start: node.range[0],
        end: node.range[1],
        text: text.slice(node.range[0], node.range[1]),
        context,
      });
      if (kind !== 'template') return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent' || key === 'loc' || key === 'range') continue;
      if (Array.isArray(value)) for (const v of value) visit(v, [...parents, node]);
      else if (value && typeof value === 'object') visit(value, [...parents, node]);
    }
  };
  visit(ast, []);
  return found;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const all = [];
  for (const file of sourceFiles()) for (const f of await scanFile(file)) all.push({file: relative(root, file), ...f});
  const json = process.argv.indexOf('--json');
  if (json > 0) writeFileSync(process.argv[json + 1], JSON.stringify(all, null, 1));
  const count = key => all.filter(f => f.context.includes(key)).length;
  console.log('occurrences', all.length, 'files', new Set(all.map(f => f.file)).size);
  for (const kind of ['string', 'template', 'jsxText']) console.log(kind, all.filter(f => f.kind === kind).length);
  for (const key of ['import', 'type', 'key', 'compare', 'attr', 'error', 'module', 'wrapped'])
    console.log(key, count(key));
}
