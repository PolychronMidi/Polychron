import { MessageFormatElement, ParserOptions, parse } from "@formatjs/icu-messageformat-parser";

//#region packages/ecma402-abstract/types/number.d.ts
type NumberFormatNotation = "standard" | "scientific" | "engineering" | "compact";
type RoundingPriorityType = "auto" | "morePrecision" | "lessPrecision";
type RoundingModeType = "ceil" | "floor" | "expand" | "trunc" | "halfCeil" | "halfFloor" | "halfExpand" | "halfTrunc" | "halfEven";
type UseGroupingType = "min2" | "auto" | "always" | boolean;
interface NumberFormatDigitOptions {
  minimumIntegerDigits?: number;
  minimumSignificantDigits?: number;
  maximumSignificantDigits?: number;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  roundingPriority?: RoundingPriorityType;
  roundingIncrement?: number;
  roundingMode?: RoundingModeType;
  trailingZeroDisplay?: TrailingZeroDisplay;
}
type NumberFormatOptionsLocaleMatcher = "lookup" | "best fit";
type NumberFormatOptionsStyle = "decimal" | "percent" | "currency" | "unit";
type NumberFormatOptionsCompactDisplay = "short" | "long";
type NumberFormatOptionsCurrencyDisplay = "symbol" | "code" | "name" | "narrowSymbol";
type NumberFormatOptionsCurrencySign = "standard" | "accounting";
type NumberFormatOptionsNotation = NumberFormatNotation;
type NumberFormatOptionsSignDisplay = "auto" | "always" | "never" | "exceptZero" | "negative";
type NumberFormatOptionsUnitDisplay = "long" | "short" | "narrow";
type TrailingZeroDisplay = "auto" | "stripIfInteger";
type NumberFormatOptions = Omit<Intl.NumberFormatOptions, "signDisplay" | "useGrouping"> & NumberFormatDigitOptions & {
  localeMatcher?: NumberFormatOptionsLocaleMatcher;
  style?: NumberFormatOptionsStyle;
  compactDisplay?: NumberFormatOptionsCompactDisplay;
  currencyDisplay?: NumberFormatOptionsCurrencyDisplay;
  currencySign?: NumberFormatOptionsCurrencySign;
  notation?: NumberFormatOptionsNotation;
  signDisplay?: NumberFormatOptionsSignDisplay;
  unit?: string;
  unitDisplay?: NumberFormatOptionsUnitDisplay;
  numberingSystem?: string;
  trailingZeroDisplay?: TrailingZeroDisplay;
  roundingPriority?: RoundingPriorityType;
  roundingIncrement?: number;
  roundingMode?: RoundingModeType;
  useGrouping?: UseGroupingType;
};
//#endregion
//#region packages/intl-messageformat/formatters.d.ts
declare global {
  namespace FormatjsIntl {
    interface Message {}
    interface IntlConfig {}
    interface Formats {}
  }
}
type Format<Source = string> = Source extends keyof FormatjsIntl.Formats ? FormatjsIntl.Formats[Source] : string;
interface Formats {
  number: Record<Format<"number">, NumberFormatOptions>;
  date: Record<Format<"date">, Intl.DateTimeFormatOptions>;
  time: Record<Format<"time">, Intl.DateTimeFormatOptions>;
}
interface FormatterCache {
  number: Record<string, NumberFormatOptions>;
  dateTime: Record<string, Intl.DateTimeFormat>;
  pluralRules: Record<string, Intl.PluralRules>;
}
interface Formatters {
  getNumberFormat(locals?: string | string[], opts?: NumberFormatOptions): Intl.NumberFormat;
  getDateTimeFormat(...args: ConstructorParameters<typeof Intl.DateTimeFormat>): Intl.DateTimeFormat;
  getPluralRules(...args: ConstructorParameters<typeof Intl.PluralRules>): Intl.PluralRules;
}
declare enum PART_TYPE {
  literal = 0,
  object = 1
}
interface LiteralPart {
  type: PART_TYPE.literal;
  value: string;
}
interface ObjectPart<T = any> {
  type: PART_TYPE.object;
  value: T;
}
type MessageFormatPart<T> = LiteralPart | ObjectPart<T>;
type PrimitiveType = string | number | bigint | boolean | null | undefined | Date;
declare function isFormatXMLElementFn<T>(el: PrimitiveType | T | FormatXMLElementFn<T>): el is FormatXMLElementFn<T>;
declare function formatToParts<T>(els: MessageFormatElement[], locales: string | string[], formatters: Formatters, formats: Formats, values?: Record<string, PrimitiveType | T | FormatXMLElementFn<T>>, currentPluralValue?: number, originalMessage?: string): MessageFormatPart<T>[];
type FormatXMLElementFn<T, R = string | T | (string | T)[]> = (parts: Array<string | T>) => R;
//#endregion
//#region packages/intl-messageformat/core.d.ts
interface Options extends Omit<ParserOptions, "locale"> {
  formatters?: Formatters;
}
declare class IntlMessageFormat {
  private readonly ast;
  private readonly locales;
  private readonly resolvedLocale?;
  private readonly formatters;
  private readonly formats;
  private readonly message;
  private readonly formatterCache;
  constructor(message: string | MessageFormatElement[], locales?: string | string[], overrideFormats?: Partial<Formats>, opts?: Options);
  format: <T = void>(values?: Record<string, PrimitiveType | T | FormatXMLElementFn<T>>) => string | T | (string | T)[];
  formatToParts: <T>(values?: Record<string, PrimitiveType | T | FormatXMLElementFn<T>>) => MessageFormatPart<T>[];
  resolvedOptions: () => {
    locale: string;
  };
  getAst: () => MessageFormatElement[];
  private static memoizedDefaultLocale;
  static get defaultLocale(): string;
  static resolveLocale: (locales: string | string[]) => Intl.Locale | undefined;
  static __parse: typeof parse | undefined;
  static formats: Formats;
}
//#endregion
//#region packages/intl-messageformat/error.d.ts
declare enum ErrorCode {
  MISSING_VALUE = "MISSING_VALUE",
  INVALID_VALUE = "INVALID_VALUE",
  MISSING_INTL_API = "MISSING_INTL_API"
}
declare class FormatError extends Error {
  readonly code: ErrorCode;
  /**
  * Original message we're trying to format
  * `undefined` if we're only dealing w/ AST
  *
  * @type {(string | undefined)}
  * @memberof FormatError
  */
  readonly originalMessage: string | undefined;
  constructor(msg: string, code: ErrorCode, originalMessage?: string);
  toString(): string;
}
declare class InvalidValueError extends FormatError {
  constructor(variableId: string, value: any, options: string[], originalMessage?: string);
}
declare class InvalidValueTypeError extends FormatError {
  constructor(value: any, type: string, originalMessage?: string);
}
declare class MissingValueError extends FormatError {
  constructor(variableId: string, originalMessage?: string);
}
//#endregion
export { ErrorCode, FormatError, FormatXMLElementFn, Formats, FormatterCache, Formatters, IntlMessageFormat, IntlMessageFormat as default, InvalidValueError, InvalidValueTypeError, LiteralPart, MessageFormatPart, MissingValueError, ObjectPart, Options, PART_TYPE, PrimitiveType, formatToParts, isFormatXMLElementFn };
//# sourceMappingURL=index.d.ts.map