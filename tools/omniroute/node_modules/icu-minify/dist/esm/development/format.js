import { T as TYPE_POUND, c as TYPE_TIME, b as TYPE_DATE, a as TYPE_NUMBER, e as TYPE_SELECTORDINAL, f as TYPE_PLURAL, d as TYPE_SELECT } from './types-Dl2aHte_.js';

// Re-export CompiledMessage type for consumers

// Could potentially share this with `use-intl` if we had a shared package for both

function format(message, locale, values = {}, options) {
  // Hot path for plain strings
  if (typeof message === 'string') {
    return message;
  }
  const result = formatNodes(message, locale, values, options, undefined);
  return optimizeResult(result);
}
function formatNodes(nodes, locale, values, options, pluralCtx) {
  const result = [];
  for (const node of nodes) {
    const formatted = formatNode(node, locale, values, options, pluralCtx);
    if (Array.isArray(formatted)) {
      result.push(...formatted);
    } else {
      result.push(formatted);
    }
  }
  return result;
}
function formatNode(node, locale, values, options, rawPluralCtx) {
  if (typeof node === 'string') {
    return node;
  }
  if (node === TYPE_POUND) {
    if (!rawPluralCtx) {
      throw new Error('# used outside of plural context');
    }
    const pluralCtx = rawPluralCtx;
    return options.formatters.getNumberFormat(pluralCtx.locale).format(pluralCtx.value);
  }
  const [name, type, ...rest] = node;

  // Simple argument: ["name"]
  if (type === undefined) {
    const value = getValue(values, name);
    {
      if (typeof value === 'boolean') {
        throw new Error(`Invalid value for argument "${name}": Boolean values are not supported and should be converted to strings if needed.`);
      }
      if (value instanceof Date) {
        throw new Error(`Invalid value for argument "${name}": Date values are not supported for plain parameters. Use date formatting instead (e.g. {${name}, date}).`);
      }
    }
    return String(value);
  }

  // Tag: ["tagName", child1, child2, ...] - detected by non-number or pound marker
  if (typeof type !== 'number' || type === TYPE_POUND) {
    return formatTag(name, [type, ...rest], locale, values, options, rawPluralCtx);
  }

  // Typed nodes: ["name", TYPE, ...]
  switch (type) {
    case TYPE_SELECT:
      return formatSelect(name, rest[0], locale, values, options, rawPluralCtx);
    case TYPE_PLURAL:
      return formatPlural(name, rest[0], locale, values, options, 'cardinal');
    case TYPE_SELECTORDINAL:
      return formatPlural(name, rest[0], locale, values, options, 'ordinal');
    case TYPE_NUMBER:
      return formatNumberValue(name, rest[0], locale, values, options);
    case TYPE_DATE:
      return formatDateTimeValue(name, rest[0], locale, values, options, 'date');
    case TYPE_TIME:
      return formatDateTimeValue(name, rest[0], locale, values, options, 'time');
    default:
      {
        throw new Error(`Unknown compiled node type: ${type}`);
      }
  }
}
function getValue(values, name) {
  if (!(name in values)) {
    throw new Error(`Missing value for argument "${name}"`);
  }
  return values[name];
}
function formatSelect(name, options, locale, values, formatOptions, pluralCtx) {
  const value = String(getValue(values, name));
  const branch = options[value] ?? options.other;
  if (!branch) {
    throw new Error(`No matching branch for select "${name}" with value "${value}"`);
  }
  return formatBranch(branch, locale, values, formatOptions, pluralCtx);
}
function formatPlural(name, options, locale, values, formatOptions, pluralType) {
  const rawValue = getValue(values, name);
  if (typeof rawValue !== 'number') {
    throw new Error(`Expected number for plural argument "${name}", got ${typeof rawValue}`);
  }
  const value = rawValue;
  const exactKey = `=${value}`;
  if (exactKey in options) {
    return formatBranch(options[exactKey], locale, values, formatOptions, {
      value,
      locale
    });
  }
  const category = formatOptions.formatters.getPluralRules(locale, {
    type: pluralType
  }).select(value);
  const branch = options[category] ?? options.other;
  if (!branch) {
    throw new Error(`No matching branch for plural "${name}" with category "${category}"`);
  }
  return formatBranch(branch, locale, values, formatOptions, {
    value,
    locale
  });
}
function formatBranch(branch, locale, values, formatOptions, pluralCtx) {
  if (typeof branch === 'string') {
    return branch;
  }
  if (branch === TYPE_POUND) {
    return formatNode(branch, locale, values, formatOptions, pluralCtx);
  }
  // Branch is an array - either a single complex node wrapped in array, or multiple nodes
  // formatNodes handles both correctly via formatNode's tag detection
  return formatNodes(branch, locale, values, formatOptions, pluralCtx);
}
function formatNumberValue(name, style, locale, values, formatOptions) {
  const rawValue = getValue(values, name);
  if (typeof rawValue !== 'number') {
    throw new Error(`Expected number for argument "${name}", got ${typeof rawValue}`);
  }
  const value = rawValue;
  const opts = getNumberFormatOptions(style, formatOptions);
  return formatOptions.formatters.getNumberFormat(locale, opts).format(value);
}
function formatDateTimeValue(name, style, locale, values, formatOptions, type) {
  const rawValue = getValue(values, name);
  if (!(rawValue instanceof Date)) {
    throw new Error(`Expected Date for argument "${name}", got ${typeof rawValue}`);
  }
  const date = rawValue;
  const baseOpts = getDateTimeFormatOptions(style, type, formatOptions);

  // Global time zone is used as default, but format-specific one takes precedence
  const opts = {
    ...baseOpts,
    timeZone: baseOpts?.timeZone ?? formatOptions.timeZone
  };
  return formatOptions.formatters.getDateTimeFormat(locale, opts).format(date);
}
function getNumberFormatOptions(style, formatOptions) {
  if (!style) return undefined;
  if (typeof style === 'string') {
    if (formatOptions.formats?.number?.[style]) {
      return formatOptions.formats.number[style];
    }
    {
      throw new Error(`Missing number format "${style}"`);
    }
  }
  return style;
}
function getDateTimeFormatOptions(style, type, formatOptions) {
  if (!style) return undefined;
  if (typeof style === 'string') {
    const resolved = formatOptions.formats?.dateTime?.[style];
    if (!resolved) {
      throw new Error(`Missing ${type} format "${style}"`);
    }
    return resolved;
  }
  return style;
}
function formatTag(name, children, locale, values, formatOptions, pluralCtx) {
  const rawHandler = getValue(values, name);
  if (typeof rawHandler !== 'function') {
    throw new Error(`Expected function for tag handler "${name}"`);
  }
  const handler = rawHandler;
  const formattedChildren = formatNodes(children, locale, values, formatOptions, pluralCtx);
  const optimized = optimizeResult(formattedChildren);
  const childArray = Array.isArray(optimized) ? optimized : [optimized];
  return handler(childArray);
}
function optimizeResult(result) {
  if (result.length === 0) {
    return '';
  }
  const merged = [];
  let currentString = '';
  for (const item of result) {
    if (typeof item === 'string') {
      currentString += item;
    } else {
      if (currentString) {
        merged.push(currentString);
        currentString = '';
      }
      merged.push(item);
    }
  }
  if (currentString) {
    merged.push(currentString);
  }
  if (merged.length === 1) {
    return merged[0];
  }
  return merged;
}

export { format as default };
