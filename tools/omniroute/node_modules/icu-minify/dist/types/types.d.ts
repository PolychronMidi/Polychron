export declare const TYPE_POUND = 0;
export declare const TYPE_SELECT = 1;
export declare const TYPE_PLURAL = 2;
export declare const TYPE_SELECTORDINAL = 3;
export declare const TYPE_NUMBER = 4;
export declare const TYPE_DATE = 5;
export declare const TYPE_TIME = 6;
export type NumberStyleOptions = Intl.NumberFormatOptions;
export type NumberStyle = string | NumberStyleOptions;
export type DateTimeStyleOptions = Intl.DateTimeFormatOptions;
export type DateTimeStyle = string | DateTimeStyleOptions;
export type PluralOptions = Record<string, CompiledNode>;
export type SelectOptions = Record<string, CompiledNode>;
export type CompiledPlainTextNode = string;
export type CompiledSimpleArgNode = [string];
export type CompiledPoundNode = typeof TYPE_POUND;
export type CompiledSelectNode = [string, typeof TYPE_SELECT, SelectOptions];
export type CompiledPluralNode = [string, typeof TYPE_PLURAL, PluralOptions];
export type CompiledSelectOrdinalNode = [
    string,
    typeof TYPE_SELECTORDINAL,
    PluralOptions
];
export type CompiledNumberNode = [string, typeof TYPE_NUMBER, NumberStyle?];
export type CompiledDateNode = [string, typeof TYPE_DATE, DateTimeStyle?];
export type CompiledTimeNode = [string, typeof TYPE_TIME, DateTimeStyle?];
export type CompiledTagNode = [string, unknown, ...Array<unknown>];
export type CompiledNode = CompiledPlainTextNode | CompiledSimpleArgNode | CompiledPoundNode | CompiledSelectNode | CompiledPluralNode | CompiledSelectOrdinalNode | CompiledNumberNode | CompiledDateNode | CompiledTimeNode | CompiledTagNode;
export type CompiledMessage = string | Array<CompiledNode>;
