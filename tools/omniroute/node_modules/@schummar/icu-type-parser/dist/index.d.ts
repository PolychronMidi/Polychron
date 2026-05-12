type Flatten<T> = T extends object ? {
    [P in keyof T]: T[P];
} : T;
type EmptyObject = Record<never, never>;
type OtherString = string & {
    __type: 'other';
};

interface GetICUArgsOptions {
    ProvidedArgs?: string;
    ICUNumberArgument?: unknown;
    ICUDateArgument?: unknown;
    ICUArgument?: unknown;
}
type Whitespace = ' ' | '\t' | '\n' | '\r';
/** Remove leading and tailing whitespace */
type Trim<T> = T extends `${Whitespace}${infer Rest}` ? Trim<Rest> : T extends `${infer Rest}${Whitespace}` ? Trim<Rest> : T extends string ? T : never;
/** Returns an array of top level blocks */
type FindBlocks<Text> = Text extends `${string}{${infer Right}` ? ReadBlock<'', Right, ''> extends [infer Block, infer Tail] ? [Block, ...FindBlocks<Tail>] : [EmptyObject] : [];
/** Find blocks for each tuple entry */
type TupleFindBlocks<T> = T extends readonly [infer First, ...infer Rest] ? [...FindBlocks<First>, ...TupleFindBlocks<Rest>] : [];
/** Read tail until the currently open block is closed. Return the block content and rest of tail */
type ReadBlock<Block extends string, Tail extends string, Depth extends string> = Tail extends `${infer L1}}${infer R1}` ? L1 extends `${infer L2}{${infer R2}` ? ReadBlock<`${Block}${L2}{`, `${R2}}${R1}`, `${Depth}+`> : Depth extends `+${infer Rest}` ? ReadBlock<`${Block}${L1}}`, R1, Rest> : [`${Block}${L1}`, R1] : [];
/** Parse block, return variables with types and recursively find nested blocks within */
type ParseBlock<Block, Opts extends GetICUArgsOptions> = Block extends `${infer Name},${infer Format},${infer Rest}` ? Trim<Format> extends 'select' ? SelectOptions<Trim<Name>, Trim<Rest>, Opts> : {
    [K in Trim<Name>]: VariableType<Trim<Format>, Opts>;
} & TupleParseBlock<TupleFindBlocks<FindBlocks<Rest>>, Opts> : Block extends `${infer Name},${infer Format}` ? {
    [K in Trim<Name>]: VariableType<Trim<Format>, Opts>;
} : {
    [K in Trim<Block>]: Opts['ICUArgument'];
};
/** Parse block for each tuple entry */
type TupleParseBlock<T, C extends GetICUArgsOptions> = T extends readonly [infer First, ...infer Rest] ? ParseBlock<First, C> & TupleParseBlock<Rest, C> : EmptyObject;
type VariableType<T extends string, Opts extends GetICUArgsOptions> = T extends 'number' | 'plural' | 'selectordinal' ? Opts['ICUNumberArgument'] : T extends 'date' | 'time' ? Opts['ICUDateArgument'] : Opts['ICUArgument'];
type SelectOptions<Name extends string, Rest, Opts extends GetICUArgsOptions> = KeepAndMerge<ParseSelectBlock<Name, Rest, Opts>>;
type ParseSelectBlock<Name extends string, Rest, Opts extends GetICUArgsOptions> = Rest extends `${infer Left}{${infer Right}` ? ReadBlock<'', Right, ''> extends [infer Block, infer Tail] ? ({
    [K in Name]: HandleOther<Trim<Left>>;
} & TupleParseBlock<FindBlocks<Block>, Opts>) | ParseSelectBlock<Name, Tail, Opts> : never : never;
type HandleOther<T> = 'other' extends T ? Exclude<T, 'other'> | OtherString : T;
type KeepAndMerge<T extends object> = T | MergeTypeUnion<T>;
type KeysFromUnion<T> = T extends T ? keyof T : never;
type SimpleTypeMerge<T, K extends keyof any> = T extends {
    [k in K]?: any;
} ? (T[K] extends OtherString ? string & {} : T[K]) : never;
type MergeTypeUnion<T extends object> = {
    [k in KeysFromUnion<T>]: SimpleTypeMerge<T, k>;
};
type EscapeLike = `'${'{' | '}' | '<' | '>'}`;
type StripEscapes<T> = T extends `${infer Left}''${infer Right}` ? `${Left}${Right}` : T extends `${infer Start}${EscapeLike}${string}'${infer End}` ? `${Start}${StripEscapes<End>}` : T extends `${infer Start}${EscapeLike}${string}` ? Start : T;
type TupleStripEscapes<T> = T extends readonly [infer First, ...infer Rest] ? [StripEscapes<First>, ...TupleStripEscapes<Rest>] : [];
type MakeProvidedOptional<T, ProvidedArgs> = {
    [K in keyof T as K extends ProvidedArgs ? never : K]: T[K];
} & {
    [K in ProvidedArgs & keyof T]?: T[K];
};
/** Calculates an object type with all variables and their types in the given ICU format string */
type GetICUArgs<T extends string | readonly string[], TOptions extends GetICUArgsOptions = GetICUArgsOptions> = Flatten<MakeProvidedOptional<TupleParseBlock<T extends readonly string[] ? TupleFindBlocks<TupleStripEscapes<T>> : FindBlocks<StripEscapes<T>>, TOptions>, 'ProvidedArgs' extends keyof TOptions ? TOptions['ProvidedArgs'] : never>>;

export type { GetICUArgs, GetICUArgsOptions };
