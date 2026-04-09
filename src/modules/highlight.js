import { escapeHtml } from './utils.js';

// Language definitions: patterns applied in order, first match wins per position
const LANGS = {
  js: {
    lineComment: '//',
    blockComment: ['/*', '*/'],
    strings: ['"', "'", '`'],
    keywords: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'class', 'extends', 'super', 'this', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'yield', 'null', 'undefined', 'true', 'false', 'void'],
  },
  py: {
    lineComment: '#',
    strings: ['"', "'"],
    tripleStrings: true,
    keywords: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'yield', 'lambda', 'pass', 'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False', 'self', 'async', 'await', 'global', 'nonlocal'],
  },
  rs: {
    lineComment: '//',
    blockComment: ['/*', '*/'],
    strings: ['"'],
    keywords: ['fn', 'let', 'mut', 'const', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'crate', 'self', 'super', 'return', 'if', 'else', 'for', 'while', 'loop', 'match', 'break', 'continue', 'move', 'ref', 'as', 'in', 'where', 'type', 'unsafe', 'async', 'await', 'dyn', 'true', 'false', 'Some', 'None', 'Ok', 'Err', 'Self'],
  },
  go: {
    lineComment: '//',
    blockComment: ['/*', '*/'],
    strings: ['"', '`'],
    keywords: ['func', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'go', 'defer', 'select', 'chan', 'map', 'struct', 'interface', 'package', 'import', 'type', 'const', 'var', 'nil', 'true', 'false', 'make', 'new', 'append', 'len', 'cap'],
  },
  html: {
    blockComment: ['<!--', '-->'],
    strings: ['"', "'"],
    keywords: [],
  },
  css: {
    blockComment: ['/*', '*/'],
    strings: ['"', "'"],
    keywords: [],
  },
  sh: {
    lineComment: '#',
    strings: ['"', "'"],
    keywords: ['if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'until', 'case', 'esac', 'function', 'return', 'local', 'export', 'source', 'echo', 'exit', 'set', 'unset', 'shift', 'true', 'false'],
  },
  json: {
    strings: ['"'],
    keywords: ['true', 'false', 'null'],
  },
};

// Map extensions to language keys
const EXT_MAP = {
  js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js',
  py: 'py',
  rs: 'rs',
  go: 'go',
  html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html', svelte: 'html',
  css: 'css', scss: 'css', less: 'css',
  sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh',
  json: 'json', yaml: 'json', yml: 'json', toml: 'json',
  c: 'rs', cpp: 'rs', h: 'rs', hpp: 'rs', java: 'rs', kt: 'rs', cs: 'rs', swift: 'rs',
};

export function highlight(code, ext) {
  const langKey = EXT_MAP[ext];
  if (!langKey) return escapeHtml(code);

  const lang = LANGS[langKey];
  if (!lang) return escapeHtml(code);

  const lines = code.split('\n');
  let inBlockComment = false;

  return lines.map(line => {
    let result = '';
    let i = 0;
    const raw = line;

    if (inBlockComment) {
      const endIdx = lang.blockComment ? raw.indexOf(lang.blockComment[1]) : -1;
      if (endIdx !== -1) {
        inBlockComment = false;
        result += `<span class="hl-comment">${escapeHtml(raw.slice(0, endIdx + lang.blockComment[1].length))}</span>`;
        i = endIdx + lang.blockComment[1].length;
      } else {
        return `<span class="hl-comment">${escapeHtml(raw)}</span>`;
      }
    }

    while (i < raw.length) {
      // Block comment start
      if (lang.blockComment && raw.startsWith(lang.blockComment[0], i)) {
        const endIdx = raw.indexOf(lang.blockComment[1], i + lang.blockComment[0].length);
        if (endIdx !== -1) {
          result += `<span class="hl-comment">${escapeHtml(raw.slice(i, endIdx + lang.blockComment[1].length))}</span>`;
          i = endIdx + lang.blockComment[1].length;
        } else {
          inBlockComment = true;
          result += `<span class="hl-comment">${escapeHtml(raw.slice(i))}</span>`;
          i = raw.length;
        }
        continue;
      }

      // Line comment
      if (lang.lineComment && raw.startsWith(lang.lineComment, i)) {
        result += `<span class="hl-comment">${escapeHtml(raw.slice(i))}</span>`;
        i = raw.length;
        continue;
      }

      // Strings
      if (lang.strings) {
        let matched = false;
        for (const q of lang.strings) {
          if (raw.startsWith(q, i)) {
            let end = i + q.length;
            while (end < raw.length) {
              if (raw[end] === '\\') { end += 2; continue; }
              if (raw.startsWith(q, end)) { end += q.length; break; }
              end++;
            }
            if (end > raw.length) end = raw.length;
            result += `<span class="hl-string">${escapeHtml(raw.slice(i, end))}</span>`;
            i = end;
            matched = true;
            break;
          }
        }
        if (matched) continue;
      }

      // Numbers
      if (/\d/.test(raw[i]) && (i === 0 || /[\s,([{=+\-*/<>!&|^~%:;]/.test(raw[i - 1]))) {
        let end = i;
        while (end < raw.length && /[\d.xXoObBeEaAfF_]/.test(raw[end])) end++;
        result += `<span class="hl-number">${escapeHtml(raw.slice(i, end))}</span>`;
        i = end;
        continue;
      }

      // Keywords
      if (/[a-zA-Z_]/.test(raw[i])) {
        let end = i;
        while (end < raw.length && /[a-zA-Z0-9_]/.test(raw[end])) end++;
        const word = raw.slice(i, end);
        if (lang.keywords && lang.keywords.includes(word)) {
          result += `<span class="hl-keyword">${escapeHtml(word)}</span>`;
        } else {
          result += escapeHtml(word);
        }
        i = end;
        continue;
      }

      result += escapeHtml(raw[i]);
      i++;
    }

    return result;
  }).join('\n');
}
