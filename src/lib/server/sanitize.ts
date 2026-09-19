import "server-only";

/**
 * 服务端富文本净化（标签 / 属性白名单）。
 *
 * 公告正文与文档正文在门户是经 dangerouslySetInnerHTML 渲染的。客户端那层
 * sanitizeHtml 只在浏览器里跑，任何人绕过界面直接 POST 表单都能把未净化的
 * 内容写进库——它是给正常用户看的护栏，不是安全边界。这里在写入前再过滤一遍，
 * 把「库里永远不存危险 HTML」变成数据库层面的既成事实。
 *
 * 与客户端版本的两点差别：
 * 1. 白名单而非黑名单。客户端版本遇到没见过的标签会放行，这里默认丢弃，
 *    新增标签必须显式加进 ALLOWED_TAGS。
 * 2. 服务端没有 DOM，因此手写分词器，而不是 DOMParser。
 *
 * 仍然不引入 DOMPurify：它的体积和 API 面远超本项目的需要，而这里要防的
 * 注入面是收敛的（管理员录入的富文本，无用户提交路径）。
 */

/** 单次净化的输入上限，防止超长文本把正则引擎拖死。 */
const MAX_INPUT_LENGTH = 200_000;

/** 嵌套深度上限：`<div>` 重复十万次时，补齐闭合标签会让输出比输入还长。 */
const MAX_NESTING_DEPTH = 100;

const ALLOWED_TAGS = new Set([
  // 结构
  "p", "div", "span", "br", "hr", "blockquote", "pre", "code",
  // 标题
  "h1", "h2", "h3", "h4", "h5", "h6",
  // 列表
  "ul", "ol", "li", "dl", "dt", "dd",
  // 行内语义
  "strong", "b", "em", "i", "u", "s", "del", "ins", "mark",
  "sub", "sup", "small", "abbr", "kbd", "samp", "var", "q", "cite", "time",
  // 链接与图片
  "a", "img", "figure", "figcaption",
  // 表格
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
]);

/** 这些标签一旦出现，连同其内容一起丢弃——它们的子节点会被浏览器当作代码而非标记。 */
const DROP_CONTENT_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "svg", "math", "template",
  "noscript", "xmp", "plaintext", "listing", "textarea", "title", "base",
  "link", "meta", "form", "frame", "frameset", "applet", "param", "source",
  "track", "audio", "video", "canvas", "select", "option", "button", "input",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "col", "wbr"]);

/**
 * HTML 里天生没有闭合标签的元素。
 *
 * DROP_CONTENT_TAGS 里的容器型标签（script / iframe …）需要连同内容一起吞掉，
 * 但 input / meta 这类空元素没有「内容」可言——若也压进抑制栈，后面整篇正文
 * 都会被当成它的内容吃掉。
 */
const VOID_ANY_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** 所有白名单标签都允许的通用属性。 */
const GLOBAL_ATTRIBUTES = new Set(["class", "title", "dir", "lang"]);

/** 仅特定标签允许的属性。 */
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title", "width", "height", "loading"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  ol: new Set(["start", "type"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  time: new Set(["datetime"]),
};

/** 属性值的形状约束；未列出的属性不限制取值（但会被转义）。 */
const VALUE_PATTERNS: Record<string, RegExp> = {
  class: /^[A-Za-z0-9_\-\s]+$/,
  width: /^\d{1,4}$/,
  height: /^\d{1,4}$/,
  colspan: /^\d{1,2}$/,
  rowspan: /^\d{1,2}$/,
  span: /^\d{1,2}$/,
  start: /^-?\d{1,9}$/,
  scope: /^(row|col|rowgroup|colgroup)$/,
  loading: /^(lazy|eager)$/,
  dir: /^(ltr|rtl|auto)$/,
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

type Token =
  | { kind: "text"; value: string }
  | { kind: "open"; name: string; attributes: Array<[string, string]>; selfClosing: boolean }
  | { kind: "close"; name: string };

/**
 * 把 HTML 切成文本 / 开标签 / 闭标签三类记号。
 *
 * 关键点是「什么样的 < 才算标签」：只有紧跟字母或斜杠的才当标签处理，
 * 其余（例如正文里的「1 < 2」）原样留作文本，避免把普通文案吃掉。
 */
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let pendingStart = 0;
  let cursor = 0;

  const flushText = (end: number) => {
    if (end > pendingStart) tokens.push({ kind: "text", value: html.slice(pendingStart, end) });
  };

  while (cursor < html.length) {
    const lt = html.indexOf("<", cursor);
    if (lt === -1) break;

    // 注释：整段丢弃，否则被注释掉的标签仍会被当成有效标记重新解析。
    if (html.startsWith("<!--", lt)) {
      flushText(lt);
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) {
        pendingStart = html.length;
        break;
      }
      cursor = pendingStart = end + 3;
      continue;
    }

    // DOCTYPE、处理指令等：同样整段丢弃。
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      flushText(lt);
      const end = html.indexOf(">", lt + 1);
      if (end === -1) {
        pendingStart = html.length;
        break;
      }
      cursor = pendingStart = end + 1;
      continue;
    }

    if (!/[A-Za-z/]/.test(html[lt + 1] ?? "")) {
      cursor = lt + 1;
      continue;
    }

    const gt = findTagEnd(html, lt + 1);
    if (gt === -1) break; // 未闭合的 '<'，剩下的都按文本处理

    flushText(lt);
    const token = parseTag(html.slice(lt + 1, gt));
    if (token) tokens.push(token);
    cursor = pendingStart = gt + 1;
  }

  flushText(html.length);
  return tokens;
}

/**
 * 找到标签真正的结束位置。
 *
 * 必须跳过引号内的 '>'，否则 `<p class="a>b">` 会在引号中间被切断，
 * 后半截 `b">` 会漏成正文。属性引号没闭合时退化为「取第一个 '>'」，
 * 保证总能切出一个标签，而不是把整篇文档吞成文本。
 */
function findTagEnd(html: string, start: number): number {
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return html.indexOf(">", start);
}

const ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;

function parseTag(raw: string): Token | null {
  const selfClosing = /\/\s*$/.test(raw);
  const trimmed = (selfClosing ? raw.replace(/\/\s*$/, "") : raw).trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/")) {
    const name = trimmed.slice(1).trim().toLowerCase();
    return /^[a-z][a-z0-9]*$/.test(name) ? { kind: "close", name } : null;
  }

  const match = /^([a-zA-Z][a-zA-Z0-9]*)/.exec(trimmed);
  if (!match) return null;

  const attributes: Array<[string, string]> = [];
  for (const attribute of trimmed.slice(match[0].length).matchAll(ATTRIBUTE_PATTERN)) {
    attributes.push([attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? ""]);
  }
  return { kind: "open", name: match[1].toLowerCase(), attributes, selfClosing };
}

/** 解码字符实体，用于在判断 URL 协议前还原「jav&#x09;ascript:」这类写法。 */
function decodeEntities(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);?/g, (match, entity: string) => {
    const code = entity.startsWith("#x") || entity.startsWith("#X")
      ? Number.parseInt(entity.slice(2), 16)
      : entity.startsWith("#")
        ? Number.parseInt(entity.slice(1), 10)
        : Number.NaN;
    if (Number.isFinite(code)) {
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** 判断 href / src 是否安全：先解码实体、再抹掉控制字符与空白，最后看协议前缀。 */
function isSafeUrl(value: string): boolean {
  const normalized = decodeEntities(value)
    .replace(/[\u0000-\u0020\u007f-\u00a0]/g, "")
    .toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("javascript:") || normalized.startsWith("vbscript:")) return false;
  // data: 只放行位图；image/svg+xml 可以内嵌脚本，一并拒绝。
  if (normalized.startsWith("data:")) return /^data:image\/(png|jpe?g|gif|webp|avif);/.test(normalized);
  return true;
}

function isAllowedAttribute(tag: string, name: string): boolean {
  if (name.startsWith("on") || name === "style" || name === "srcdoc" || name === "xmlns") return false;
  if (GLOBAL_ATTRIBUTES.has(name)) return true;
  return TAG_ATTRIBUTES[tag]?.has(name) ?? false;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 按白名单重建 HTML。
 *
 * 不在白名单里的标签一律丢弃（原始文本型标签连同内容），属性逐个复核，
 * 最后补齐未闭合的标签，保证输出是一段结构完整的片段。
 */
export function sanitizeRichText(input: string): string {
  if (!input) return "";
  const html = input.length > MAX_INPUT_LENGTH ? input.slice(0, MAX_INPUT_LENGTH) : input;

  const out: string[] = [];
  const suppressed: string[] = [];
  const openStack: string[] = [];

  for (const token of tokenize(html)) {
    if (token.kind === "text") {
      if (!suppressed.length) out.push(token.value.replace(/</g, "&lt;"));
      continue;
    }

    if (token.kind === "close") {
      if (suppressed.length) {
        if (suppressed[suppressed.length - 1] === token.name) suppressed.pop();
        continue;
      }
      if (VOID_TAGS.has(token.name) || !ALLOWED_TAGS.has(token.name)) continue;
      // 只接受与栈顶配对的闭合标签；错位的直接忽略，由结尾统一补齐。
      if (openStack[openStack.length - 1] === token.name) {
        openStack.pop();
        out.push(`</${token.name}>`);
      }
      continue;
    }

    const allowed = ALLOWED_TAGS.has(token.name);
    if (suppressed.length || !allowed) {
      if (DROP_CONTENT_TAGS.has(token.name) && !token.selfClosing && !VOID_ANY_TAGS.has(token.name)) {
        suppressed.push(token.name);
      }
      continue;
    }

    // 深度超限时直接丢弃标签：只压栈不输出会让开闭标签数量失衡。
    if (!VOID_TAGS.has(token.name) && openStack.length >= MAX_NESTING_DEPTH) continue;

    const rendered: string[] = [];
    for (const [name, value] of token.attributes) {
      if (!isAllowedAttribute(token.name, name)) continue;
      const pattern = VALUE_PATTERNS[name];
      if (pattern && !pattern.test(value.trim())) continue;
      if (name === "href" || name === "src") {
        const url = value.trim();
        if (!isSafeUrl(url)) continue;
        rendered.push(`${name}="${escapeAttribute(url)}"`);
        continue;
      }
      rendered.push(`${name}="${escapeAttribute(value)}"`);
    }

    // 外链一律新窗口打开并阻断 window.opener，不采纳录入者自己写的 target/rel。
    if (token.name === "a") rendered.push('target="_blank"', 'rel="noopener noreferrer"');

    const suffix = rendered.length ? ` ${rendered.join(" ")}` : "";
    out.push(`<${token.name}${suffix}>`);
    // <div/> 这类「非空元素却写成自闭合」在 HTML 里等同 <div>，因此照样入栈，
    // 由结尾统一补齐闭合标签。
    if (!VOID_TAGS.has(token.name)) openStack.push(token.name);
  }

  for (let index = openStack.length - 1; index >= 0; index -= 1) out.push(`</${openStack[index]}>`);
  return out.join("");
}

/** 净化后是否还有可见内容；用于拒绝「整段都是被过滤掉的标签」的空正文。 */
export function hasVisibleContent(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "").length > 0 || /<(img|hr|br)\b/i.test(html);
}
