//#region packages/icu-skeleton-parser/date-time.d.ts
/**
* Parse Date time skeleton into Intl.DateTimeFormatOptions
* Ref: https://unicode.org/reports/tr35/tr35-dates.html#Date_Field_Symbol_Table
* @public
* @param skeleton skeleton string
*/
declare function parseDateTimeSkeleton(skeleton: string): Intl.DateTimeFormatOptions;
//#endregion
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
//#region packages/icu-skeleton-parser/number.d.ts
interface ExtendedNumberFormatOptions extends NumberFormatOptions {
  scale?: number;
}
interface NumberSkeletonToken {
  stem: string;
  options: string[];
}
declare function parseNumberSkeletonFromString(skeleton: string): NumberSkeletonToken[];
/**
* https://github.com/unicode-org/icu/blob/master/docs/userguide/format_parse/numbers/skeletons.md#skeleton-stems-and-options
*/
declare function parseNumberSkeleton(tokens: NumberSkeletonToken[]): ExtendedNumberFormatOptions;
//#endregion
export { ExtendedNumberFormatOptions, NumberSkeletonToken, parseDateTimeSkeleton, parseNumberSkeleton, parseNumberSkeletonFromString };
//# sourceMappingURL=index.d.ts.map