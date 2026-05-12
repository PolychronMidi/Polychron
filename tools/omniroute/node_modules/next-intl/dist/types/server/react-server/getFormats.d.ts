declare function getFormatsCachedImpl(): Promise<import("use-intl").Formats | undefined>;
declare const getFormats: typeof getFormatsCachedImpl;
export default getFormats;
