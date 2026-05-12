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
//#region packages/icu-messageformat-parser/no-parser.d.ts
declare function parse(): void;
declare const _Parser: undefined;
//#endregion
export { ArgumentElement, BaseElement, DateElement, DateTimeSkeleton, ExtendedNumberFormatOptions, LiteralElement, Location, LocationDetails, MessageFormatElement, NumberElement, NumberSkeleton, PluralElement, PluralOrSelectOption, PoundElement, SKELETON_TYPE, SelectElement, SimpleFormatElement, Skeleton, TYPE, TagElement, TimeElement, ValidPluralRule, _Parser, createLiteralElement, createNumberElement, isArgumentElement, isDateElement, isDateTimeSkeleton, isLiteralElement, isNumberElement, isNumberSkeleton, isPluralElement, isPoundElement, isSelectElement, isStructurallySame, isTagElement, isTimeElement, parse };
//# sourceMappingURL=no-parser.d.ts.map