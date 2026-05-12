import { parse, TYPE } from '@formatjs/icu-messageformat-parser';
import { T as TYPE_POUND, a as TYPE_NUMBER, b as TYPE_DATE, c as TYPE_TIME, d as TYPE_SELECT, e as TYPE_SELECTORDINAL, f as TYPE_PLURAL } from './types-Dl2aHte_.js';

function compile(message) {
  const ast = parse(message);
  const compiled = compileNodes(ast);
  if (compiled.length === 0) {
    return '';
  }
  if (compiled.length === 1 && typeof compiled[0] === 'string') {
    return compiled[0];
  }
  return compiled;
}
function compileNodes(nodes) {
  const result = [];
  for (const node of nodes) {
    const compiled = compileNode(node);
    if (typeof compiled === 'string' && result.length > 0 && typeof result[result.length - 1] === 'string') {
      result[result.length - 1] += compiled;
    } else {
      result.push(compiled);
    }
  }
  return result;
}
function compileNodesToNode(nodes) {
  const compiled = compileNodes(nodes);
  if (compiled.length === 0) {
    return '';
  }
  if (compiled.length === 1) {
    const node = compiled[0];
    // Only unwrap strings and pound signs, not array-based nodes (tags, typed nodes)
    // This preserves structure for formatBranch to correctly identify single nodes vs arrays
    if (typeof node === 'string' || node === TYPE_POUND) {
      return node;
    }
  }
  return compiled;
}
function compileNode(node) {
  switch (node.type) {
    case TYPE.literal:
      return node.value;
    case TYPE.argument:
      return [node.value];
    case TYPE.number:
      return compileNumber(node);
    case TYPE.date:
      return compileDate(node);
    case TYPE.time:
      return compileTime(node);
    case TYPE.select:
      return compileSelect(node);
    case TYPE.plural:
      return compilePlural(node);
    case TYPE.pound:
      return TYPE_POUND;
    case TYPE.tag:
      return compileTag(node);
    default:
      throw new Error(`Unknown AST node type: ${node.type}`);
  }
}
function compileNumber(node) {
  const result = [node.value, TYPE_NUMBER];
  const style = compileNumberStyle(node.style);
  if (style !== undefined) {
    result.push(style);
  }
  return result;
}
function compileNumberStyle(style) {
  if (!style) {
    return undefined;
  }
  if (typeof style === 'string') {
    return style;
  }
  if ('parsedOptions' in style) {
    const opts = style.parsedOptions;
    return Object.keys(opts).length > 0 ? opts : undefined;
  }
  return undefined;
}
function compileDate(node) {
  const result = [node.value, TYPE_DATE];
  const style = compileDateTimeStyle(node.style);
  if (style !== undefined) {
    result.push(style);
  }
  return result;
}
function compileTime(node) {
  const result = [node.value, TYPE_TIME];
  const style = compileDateTimeStyle(node.style);
  if (style !== undefined) {
    result.push(style);
  }
  return result;
}
function compileDateTimeStyle(style) {
  if (!style) {
    return undefined;
  }
  if (typeof style === 'string') {
    return style;
  }
  if ('parsedOptions' in style) {
    const opts = style.parsedOptions;
    return Object.keys(opts).length > 0 ? opts : undefined;
  }
  return undefined;
}
function compileSelect(node) {
  const options = Object.create(null);
  for (const [key, option] of Object.entries(node.options)) {
    options[key] = compileNodesToNode(option.value);
  }
  return [node.value, TYPE_SELECT, options];
}

// Plural offset is not supported
function compilePlural(node) {
  if (node.offset) {
    throw new Error('Plural offsets are not supported');
  }
  const options = Object.create(null);
  for (const [key, option] of Object.entries(node.options)) {
    options[key] = compileNodesToNode(option.value);
  }
  return [node.value, node.pluralType === 'ordinal' ? TYPE_SELECTORDINAL : TYPE_PLURAL, options];
}
function compileTag(node) {
  const children = compileNodes(node.children);
  const result = [node.value];

  // Tags have no type number - detected at runtime by typeof node[1] !== 'number'
  // Empty tags get an empty string child to distinguish from simple arguments
  if (children.length === 0) {
    result.push('');
  } else {
    result.push(...children);
  }
  return result;
}

export { compile as default };
