import type IntlErrorCode from './IntlErrorCode.js';
export default class IntlError extends Error {
    readonly code: IntlErrorCode;
    readonly originalMessage: string | undefined;
    constructor(code: IntlErrorCode, originalMessage?: string);
}
