/**
 * JDK21→JDK8 instanceof 模式匹配降级转换
 *
 * Java 16+ 支持模式匹配：if (expr instanceof Type var) { ... }
 * JDK8 不支持，需降级为：
 *   if (expr instanceof Type) {
 *       Type var = (Type) expr;
 *       ...
 *   }
 *
 * 仅处理 if / while 条件中的标准场景；取反、复合条件引用模式变量、
 * 同一条件多模式等复杂场景保守跳过（记入 skipped），绝不产出无法编译的代码。
 */

// 生成与 content 等长的掩码：true = 该字符位于注释或字符串/字符字面量内部
// 覆盖：// 行注释、块注释、"..." 字符串、'...' 字符、"""...""" 文本块
function buildCodeMask(content) {
  const mask = new Array(content.length).fill(false);
  const n = content.length;
  let state = 'normal';
  let i = 0;
  while (i < n) {
    const c = content[i];
    const c2 = i + 1 < n ? content[i + 1] : '';
    const c3 = i + 2 < n ? content[i + 2] : '';
    if (state === 'normal') {
      if (c === '/' && c2 === '/') {
        mask[i] = true; mask[i + 1] = true; state = 'line'; i += 2;
      } else if (c === '/' && c2 === '*') {
        mask[i] = true; mask[i + 1] = true; state = 'block'; i += 2;
      } else if (c === '"' && c2 === '"' && c3 === '"') {
        mask[i] = true; mask[i + 1] = true; mask[i + 2] = true; state = 'text'; i += 3;
      } else if (c === '"') {
        mask[i] = true; state = 'string'; i += 1;
      } else if (c === "'") {
        mask[i] = true; state = 'char'; i += 1;
      } else {
        i += 1;
      }
    } else if (state === 'line') {
      mask[i] = true;
      if (c === '\n') state = 'normal';
      i += 1;
    } else if (state === 'block') {
      mask[i] = true;
      if (c === '*' && c2 === '/') {
        mask[i + 1] = true; state = 'normal'; i += 2;
      } else {
        i += 1;
      }
    } else if (state === 'string') {
      mask[i] = true;
      if (c === '\\') {
        if (i + 1 < n) mask[i + 1] = true;
        i += 2;
      } else {
        if (c === '"') state = 'normal';
        i += 1;
      }
    } else if (state === 'char') {
      mask[i] = true;
      if (c === '\\') {
        if (i + 1 < n) mask[i + 1] = true;
        i += 2;
      } else {
        if (c === "'") state = 'normal';
        i += 1;
      }
    } else { // text 文本块
      mask[i] = true;
      if (c === '"' && c2 === '"' && c3 === '"') {
        mask[i + 1] = true; mask[i + 2] = true; state = 'normal'; i += 3;
      } else if (c === '\\') {
        if (i + 1 < n) mask[i + 1] = true;
        i += 2;
      } else {
        i += 1;
      }
    }
  }
  return mask;
}

/**
 * 将 content 中的 instanceof 模式匹配转换为 JDK8 兼容写法
 * @returns {{ content: string, count: number, skipped: Array<{expr: string, type: string, var: string, reason: string}> }}
 */
function transformInstanceofPatterns(content) {
  const mask = buildCodeMask(content);
  // expr 限标识符链（obj / this.a.b）或单层括号包裹的标识符链（(x)）；Type 为类名（支持 Map.Entry 内部类、com.foo.Bar 全限定名）；var 小写变量名
  const pattern = /(\(\s*[\w.$]+\s*\)|[\w.$]+)\s+instanceof\s+((?:[a-z_$][\w$]*\.)*[A-Z][\w.$]*)\s+([a-z_$][\w$]*)/g;
  const matches = [];
  let m;
  while ((m = pattern.exec(content)) !== null) {
    let inNonCode = false;
    for (let k = m.index; k < m.index + m[0].length; k++) {
      if (mask[k]) { inNonCode = true; break; }
    }
    if (!inNonCode) {
      matches.push({ index: m.index, length: m[0].length, expr: m[1], type: m[2], varName: m[3] });
    }
  }
  if (matches.length === 0) return { content, count: 0, skipped: [] };

  const skipped = [];
  let result = content;
  let count = 0;

  // 从后往前处理：已修改区域总位于当前匹配之后，不影响当前匹配及其之前的索引与掩码
  for (let mi = matches.length - 1; mi >= 0; mi--) {
    const { index, length, expr, type, varName } = matches[mi];

    // a. 向前找最近的（代码区域内的）if/while 的 '('，并验证匹配位于其条件括号内
    const headRe = /\b(if|while)\s*\(/g;
    let kw = null;
    let hm;
    while ((hm = headRe.exec(result)) !== null) {
      if (hm.index >= index) break;
      if (mask[hm.index]) continue; // 注释/字符串中的 if/while 不算
      kw = { kwIndex: hm.index, openParen: hm.index + hm[0].length - 1 };
    }
    if (!kw) {
      skipped.push({ expr, type, var: varName, reason: '未找到包裹的 if/while 条件' });
      continue;
    }
    let depth = 0;
    let enclosed = true;
    for (let k = kw.openParen; k < index; k++) {
      if (mask[k]) continue;
      if (result[k] === '(') depth++;
      else if (result[k] === ')') {
        depth--;
        if (depth === 0) { enclosed = false; break; }
      }
    }
    if (!enclosed) {
      skipped.push({ expr, type, var: varName, reason: '未位于 if/while 条件括号内' });
      continue;
    }

    // b. 条件内、匹配之前含 ! / && / ||（取反或括号嵌套复合表达式）→ 保守跳过
    const beforeText = result.slice(kw.openParen + 1, index);
    if (/!|&&|\|\|/.test(beforeText)) {
      skipped.push({ expr, type, var: varName, reason: '条件内含 !/&&/||，语义复杂' });
      continue;
    }

    // c. 定位条件闭合 ')'，检查匹配之后到 ')' 之间的文本
    let d2 = 0;
    let closeParen = -1;
    for (let k = kw.openParen; k < result.length; k++) {
      if (mask[k]) continue;
      if (result[k] === '(') d2++;
      else if (result[k] === ')') {
        d2--;
        if (d2 === 0) { closeParen = k; break; }
      }
    }
    if (closeParen === -1) {
      skipped.push({ expr, type, var: varName, reason: '未找到条件闭合括号' });
      continue;
    }
    const afterText = result.slice(index + length, closeParen);
    // c1. 右侧含 ||：进入块时 instanceof 可能为 false，强制转换会抛 ClassCastException → 跳过
    if (/\|\|/.test(afterText)) {
      skipped.push({ expr, type, var: varName, reason: '条件右侧含 ||，类型转换可能在不满足 instanceof 时执行' });
      continue;
    }
    // c2. 右侧还有 instanceof（同一条件多模式）→ 跳过，避免只转一半仍编译失败
    if (/\binstanceof\b/.test(afterText)) {
      skipped.push({ expr, type, var: varName, reason: '同一条件含多个 instanceof 模式' });
      continue;
    }
    // c3. 右侧引用模式变量（如 && s.length() > 0）→ 机械替换会失去变量定义，跳过
    const varUseRe = new RegExp('\\b' + varName + '\\b');
    if (varUseRe.test(afterText)) {
      skipped.push({ expr, type, var: varName, reason: '复合条件右侧引用了模式变量' });
      continue;
    }

    // d. 闭合 ')' 之后（跳过空白）必须是 '{'，否则为单行语句 → 跳过
    let bracePos = closeParen + 1;
    while (bracePos < result.length && /\s/.test(result[bracePos])) bracePos++;
    if (bracePos >= result.length || result[bracePos] !== '{') {
      skipped.push({ expr, type, var: varName, reason: '条件后无 { 代码块' });
      continue;
    }

    // e. 声明缩进 = if/while 行前导空白 + 一级（前导含 tab 用 '\t'，否则 4 空格）
    let lineStart = kw.kwIndex;
    while (lineStart > 0 && result[lineStart - 1] !== '\n') lineStart--;
    const indentMatch = result.slice(lineStart, kw.kwIndex + 1).match(/^[ \t]*/);
    const lineIndent = indentMatch ? indentMatch[0] : '';
    const declIndent = lineIndent + (lineIndent.includes('\t') ? '\t' : '    ');

    // f. 先在 '{' 后插入声明（索引靠后），再替换匹配文本（索引靠前），互不影响
    const decl = '\n' + declIndent + type + ' ' + varName + ' = (' + type + ') ' + expr + ';';
    result = result.slice(0, bracePos + 1) + decl + result.slice(bracePos + 1);
    result = result.slice(0, index) + expr + ' instanceof ' + type + result.slice(index + length);
    count++;
  }

  return { content: result, count, skipped };
}

module.exports = { transformInstanceofPatterns, buildCodeMask };
