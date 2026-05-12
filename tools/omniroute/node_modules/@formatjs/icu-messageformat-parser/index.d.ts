import { NumberSkeletonToken } from "@formatjs/icu-skeleton-parser";

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
//#region packages/icu-messageformat-parser/types.d.ts
interface ExtendedNumberFormatOptions extends NumberFormatOptions {
  scale?: number;
}
declare enum TYPE {
  /**
  * Raw text
  */
  literal = 0,
  /**
  * Variable w/o any format, e.g `var` in `this is a {var}`
  */
  argument = 1,
  /**
  * Variable w/ number format
  */
  number = 2,
  /**
  * Variable w/ date format
  */
  date = 3,
  /**
  * Variable w/ time format
  */
  time = 4,
  /**
  * Variable w/ select format
  */
  select = 5,
  /**
  * Variable w/ plural format
  */
  plural = 6,
  /**
  * Only possible within plural argument.
  * This is the `#` symbol that will be substituted with the count.
  */
  pound = 7,
  /**
  * XML-like tag
  */
  tag = 8
}
declare enum SKELETON_TYPE {
  number = 0,
  dateTime = 1
}
interface LocationDetails {
  offset: number;
  line: number;
  column: number;
}
interface Location {
  start: LocationDetails;
  end: LocationDetails;
}
interface BaseElement<T extends TYPE> {
  type: T;
  value: string;
  location?: Location;
}
type LiteralElement = BaseElement<TYPE.literal>;
type ArgumentElement = BaseElement<TYPE.argument>;
interface TagElement extends BaseElement<TYPE.tag> {
  children: MessageFormatElement[];
}
interface SimpleFormatElement<T extends TYPE, S extends Skeleton> extends BaseElement<T> {
  style?: string | S | null;
}
type NumberElement = SimpleFormatElement<TYPE.number, NumberSkeleton>;
type DateElement = SimpleFormatElement<TYPE.date, DateTimeSkeleton>;
type TimeElement = SimpleFormatElement<TYPE.time, DateTimeSkeleton>;
type ValidPluralRule = "zero" | "one" | "two" | "few" | "many" | "other" | string;
interface PluralOrSelectOption {
  value: MessageFormatElement[];
  location?: Location;
}
interface SelectElement extends BaseElement<TYPE.select> {
  options: Record<string, PluralOrSelectOption>;
}
interface PluralElement extends BaseElement<TYPE.plural> {
  options: Record<ValidPluralRule, PluralOrSelectOption>;
  offset: number;
  pluralType: Intl.PluralRulesOptions["type"];
}
interface PoundElement {
  type: TYPE.pound;
  location?: Location;
}
type MessageFormatElement = ArgumentElement | DateElement | LiteralElement | NumberElement | PluralElement | PoundElement | SelectElement | TagElement | TimeElement;
interface NumberSkeleton {
  type: SKELETON_TYPE.number;
  tokens: NumberSkeletonToken[];
  location?: Location;
  parsedOptions: ExtendedNumberFormatOptions;
}
interface DateTimeSkeleton {
  type: SKELETON_TYPE.dateTime;
  pattern: string;
  location?: Location;
  parsedOptions: Intl.DateTimeFormatOptions;
}
type Skeleton = NumberSkeleton | DateTimeSkeleton;
/**
* Type Guards
*/
declare function isLiteralElement(el: MessageFormatElement): el is LiteralElement;
declare function isArgumentElement(el: MessageFormatElement): el is ArgumentElement;
declare function isNumberElement(el: MessageFormatElement): el is NumberElement;
declare function isDateElement(el: MessageFormatElement): el is DateElement;
declare function isTimeElement(el: MessageFormatElement): el is TimeElement;
declare function isSelectElement(el: MessageFormatElement): el is SelectElement;
declare function isPluralElement(el: MessageFormatElement): el is PluralElement;
declare function isPoundElement(el: MessageFormatElement): el is PoundElement;
declare function isTagElement(el: MessageFormatElement): el is TagElement;
declare function isNumberSkeleton(el: NumberElement["style"] | Skeleton): el is NumberSkeleton;
declare function isDateTimeSkeleton(el?: DateElement["style"] | TimeElement["style"] | Skeleton): el is DateTimeSkeleton;
declare function createLiteralElement(value: string): LiteralElement;
declare function createNumberElement(value: string, style?: string | null): NumberElement;
//#endregion
//#region packages/icu-messageformat-parser/error.d.ts
interface ParserError {
  kind: ErrorKind;
  message: string;
  location: Location;
}
declare enum ErrorKind {
  /** Argument is unclosed (e.g. `{0`) */
  EXPECT_ARGUMENT_CLOSING_BRACE = 1,
  /** Argument is empty (e.g. `{}`). */
  EMPTY_ARGUMENT = 2,
  /** Argument is malformed (e.g. `{foo!}``) */
  MALFORMED_ARGUMENT = 3,
  /** Expect an argument type (e.g. `{foo,}`) */
  EXPECT_ARGUMENT_TYPE = 4,
  /** Unsupported argument type (e.g. `{foo,foo}`) */
  INVALID_ARGUMENT_TYPE = 5,
  /** Expect an argument style (e.g. `{foo, number, }`) */
  EXPECT_ARGUMENT_STYLE = 6,
  /** The number skeleton is invalid. */
  INVALID_NUMBER_SKELETON = 7,
  /** The date time skeleton is invalid. */
  INVALID_DATE_TIME_SKELETON = 8,
  /** Exepct a number skeleton following the `::` (e.g. `{foo, number, ::}`) */
  EXPECT_NUMBER_SKELETON = 9,
  /** Exepct a date time skeleton following the `::` (e.g. `{foo, date, ::}`) */
  EXPECT_DATE_TIME_SKELETON = 10,
  /** Unmatched apostrophes in the argument style (e.g. `{foo, number, 'test`) */
  UNCLOSED_QUOTE_IN_ARGUMENT_STYLE = 11,
  /** Missing select argument options (e.g. `{foo, select}`) */
  EXPECT_SELECT_ARGUMENT_OPTIONS = 12,
  /** Expecting an offset value in `plural` or `selectordinal` argument (e.g `{foo, plural, offset}`) */
  EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE = 13,
  /** Offset value in `plural` or `selectordinal` is invalid (e.g. `{foo, plural, offset: x}`) */
  INVALID_PLURAL_ARGUMENT_OFFSET_VALUE = 14,
  /** Expecting a selector in `select` argument (e.g `{foo, select}`) */
  EXPECT_SELECT_ARGUMENT_SELECTOR = 15,
  /** Expecting a selector in `plural` or `selectordinal` argument (e.g `{foo, plural}`) */
  EXPECT_PLURAL_ARGUMENT_SELECTOR = 16,
  /** Expecting a message fragment after the `select` selector (e.g. `{foo, select, apple}`) */
  EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT = 17,
  /**
  * Expecting a message fragment after the `plural` or `selectordinal` selector
  * (e.g. `{foo, plural, one}`)
  */
  EXPECT_PLURAL_ARGUMENT_SELECTOR_FRAGMENT = 18,
  /** Selector in `plural` or `selectordinal` is malformed (e.g. `{foo, plural, =x {#}}`) */
  INVALID_PLURAL_ARGUMENT_SELECTOR = 19,
  /**
  * Duplicate selectors in `plural` or `selectordinal` argument.
  * (e.g. {foo, plural, one {#} one {#}})
  */
  DUPLICATE_PLURAL_ARGUMENT_SELECTOR = 20,
  /** Duplicate selectors in `select` argument.
  * (e.g. {foo, select, apple {apple} apple {apple}})
  */
  DUPLICATE_SELECT_ARGUMENT_SELECTOR = 21,
  /** Plural or select argument option must have `other` clause. */
  MISSING_OTHER_CLAUSE = 22,
  /** The tag is malformed. (e.g. `<bold!>foo</bold!>) */
  INVALID_TAG = 23,
  /** The tag name is invalid. (e.g. `<123>foo</123>`) */
  INVALID_TAG_NAME = 25,
  /** The closing tag does not match the opening tag. (e.g. `<bold>foo</italic>`) */
  UNMATCHED_CLOSING_TAG = 26,
  /** The opening tag has unmatched closing tag. (e.g. `<bold>foo`) */
  UNCLOSED_TAG = 27
}
//#endregion
//#region packages/icu-messageformat-parser/parser.d.ts
interface ParserOptions {
  /**
  * Whether to treat HTML/XML tags as string literal
  * instead of parsing them as tag token.
  * When this is false we only allow simple tags without
  * any attributes
  */
  ignoreTag?: boolean;
  /**
  * Should `select`, `selectordinal`, and `plural` arguments always include
  * the `other` case clause.
  */
  requiresOtherClause?: boolean;
  /**
  * Whether to parse number/datetime skeleton
  * into Intl.NumberFormatOptions and Intl.DateTimeFormatOptions, respectively.
  */
  shouldParseSkeletons?: boolean;
  /**
  * Capture location info in AST
  * Default is false
  */
  captureLocation?: boolean;
  /**
  * Instance of Intl.Locale to resolve locale-dependent skeleton
  */
  locale?: Intl.Locale;
}
type Result<T, E> = {
  val: T;
  err: null;
} | {
  val: null;
  err: E;
};
declare class Parser {
  private message;
  private position;
  private locale?;
  private ignoreTag;
  private requiresOtherClause;
  private shouldParseSkeletons?;
  constructor(message: string, options?: ParserOptions);
  parse(): Result<MessageFormatElement[], ParserError>;
  private parseMessage;
  /**
  * A tag name must start with an ASCII lower/upper case letter. The grammar is based on the
  * [custom element name][] except that a dash is NOT always mandatory and uppercase letters
  * are accepted:
  *
  * ```
  * tag ::= "<" tagName (whitespace)* "/>" | "<" tagName (whitespace)* ">" message "</" tagName (whitespace)* ">"
  * tagName ::= [a-z] (PENChar)*
  * PENChar ::=
  *     "-" | "." | [0-9] | "_" | [a-z] | [A-Z] | #xB7 | [#xC0-#xD6] | [#xD8-#xF6] | [#xF8-#x37D] |
  *     [#x37F-#x1FFF] | [#x200C-#x200D] | [#x203F-#x2040] | [#x2070-#x218F] | [#x2C00-#x2FEF] |
  *     [#x3001-#xD7FF] | [#xF900-#xFDCF] | [#xFDF0-#xFFFD] | [#x10000-#xEFFFF]
  * ```
  *
  * [custom element name]: https://html.spec.whatwg.org/multipage/custom-elements.html#valid-custom-element-name
  * NOTE: We're a bit more lax here since HTML technically does not allow uppercase HTML element but we do
  * since other tag-based engines like React allow it
  */
  private parseTag;
  /**
  * This method assumes that the caller has peeked ahead for the first tag character.
  */
  private parseTagName;
  private parseLiteral;
  tryParseLeftAngleBracket(): string | null;
  /**
  * Starting with ICU 4.8, an ASCII apostrophe only starts quoted text if it immediately precedes
  * a character that requires quoting (that is, "only where needed"), and works the same in
  * nested messages as on the top level of the pattern. The new behavior is otherwise compatible.
  */
  private tryParseQuote;
  private tryParseUnquoted;
  private parseArgument;
  /**
  * Advance the parser until the end of the identifier, if it is currently on
  * an identifier character. Return an empty string otherwise.
  */
  private parseIdentifierIfPossible;
  private parseArgumentOptions;
  private tryParseArgumentClose;
  /**
  * See: https://github.com/unicode-org/icu/blob/af7ed1f6d2298013dc303628438ec4abe1f16479/icu4c/source/common/messagepattern.cpp#L659
  */
  private parseSimpleArgStyleIfPossible;
  private parseNumberSkeletonFromString;
  /**
  * @param nesting_level The current nesting level of messages.
  *     This can be positive when parsing message fragment in select or plural argument options.
  * @param parent_arg_type The parent argument's type.
  * @param parsed_first_identifier If provided, this is the first identifier-like selector of
  *     the argument. It is a by-product of a previous parsing attempt.
  * @param expecting_close_tag If true, this message is directly or indirectly nested inside
  *     between a pair of opening and closing tags. The nested message will not parse beyond
  *     the closing tag boundary.
  */
  private tryParsePluralOrSelectOptions;
  private tryParseDecimalInteger;
  private offset;
  private isEOF;
  private clonePosition;
  /**
  * Return the code point at the current position of the parser.
  * Throws if the index is out of bound.
  */
  private char;
  private error;
  /** Bump the parser to the next UTF-16 code unit. */
  private bump;
  /**
  * If the substring starting at the current position of the parser has
  * the given prefix, then bump the parser to the character immediately
  * following the prefix and return true. Otherwise, don't bump the parser
  * and return false.
  */
  private bumpIf;
  /**
  * Bump the parser until the pattern character is found and return `true`.
  * Otherwise bump to the end of the file and return `false`.
  */
  private bumpUntil;
  /**
  * Bump the parser to the target offset.
  * If target offset is beyond the end of the input, bump the parser to the end of the input.
  */
  private bumpTo;
  /** advance the parser through all whitespace to the next non-whitespace code unit. */
  private bumpSpace;
  /**
  * Peek at the *next* Unicode codepoint in the input without advancing the parser.
  * If the input has been exhausted, then this returns null.
  */
  private peek;
}
//#endregion
//#region packages/icu-messageformat-parser/manipulator.d.ts
interface IsStructurallySameResult {
  error?: Error;
  success: boolean;
}
/**
* Check if 2 ASTs are structurally the same. This primarily means that
* they have the same variables with the same type
* @param a
* @param b
* @returns
*/
declare function isStructurallySame(a: MessageFormatElement[], b: MessageFormatElement[]): IsStructurallySameResult;
//#endregion
//#region packages/icu-messageformat-parser/index.d.ts
declare function parse(message: string, opts?: ParserOptions): MessageFormatElement[];
declare const _Parser: typeof Parser;
//#endregion
export { ArgumentElement, BaseElement, DateElement, DateTimeSkeleton, ExtendedNumberFormatOptions, LiteralElement, Location, LocationDetails, MessageFormatElement, NumberElement, NumberSkeleton, type ParserOptions, PluralElement, PluralOrSelectOption, PoundElement, SKELETON_TYPE, SelectElement, SimpleFormatElement, Skeleton, TYPE, TagElement, TimeElement, ValidPluralRule, _Parser, createLiteralElement, createNumberElement, isArgumentElement, isDateElement, isDateTimeSkeleton, isLiteralElement, isNumberElement, isNumberSkeleton, isPluralElement, isPoundElement, isSelectElement, isStructurallySame, isTagElement, isTimeElement, parse };
//# sourceMappingURL=index.d.ts.map