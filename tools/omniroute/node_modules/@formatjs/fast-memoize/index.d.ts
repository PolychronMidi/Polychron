//#region packages/fast-memoize/index.d.ts
type Func = (...args: any[]) => any;
interface Cache<K, V> {
  create: CacheCreateFunc<K, V>;
}
interface CacheCreateFunc<K, V> {
  (): DefaultCache<K, V>;
}
interface DefaultCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V | undefined): void;
}
type Serializer = (args: any[]) => string;
interface Options<F extends Func> {
  cache?: Cache<string, ReturnType<F>>;
  serializer?: Serializer;
  strategy?: MemoizeFunc<F>;
}
interface ResolvedOptions<F extends Func> {
  cache: Cache<string, ReturnType<F>>;
  serializer: Serializer;
}
interface MemoizeFunc<F extends Func> {
  (fn: F, options?: Options<F>): F;
}
declare function memoize<F extends Func>(fn: F, options?: Options<F>): F;
type StrategyFn = <F extends Func>(this: unknown, fn: F, cache: DefaultCache<string, ReturnType<F>>, serializer: Serializer, arg: any) => any;
interface Strategies<F extends Func> {
  variadic: MemoizeFunc<F>;
  monadic: MemoizeFunc<F>;
}
declare const strategies: Strategies<Func>;
//#endregion
export { Cache, MemoizeFunc, Options, ResolvedOptions, Serializer, Strategies, StrategyFn, memoize, strategies };
//# sourceMappingURL=index.d.ts.map