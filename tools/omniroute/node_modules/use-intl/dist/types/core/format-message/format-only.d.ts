import { type CompiledMessage } from 'icu-minify/format';
import type { FormatMessage } from './types.js';
/**
 * Formats a precompiled ICU message using icu-minify/format.
 * This implementation requires messages to be precompiled at build time.
 */
declare function formatMessage(
/** The precompiled ICU message (CompiledMessage from icu-minify) */
...[, message, values, options]: Parameters<FormatMessage<CompiledMessage>>): ReturnType<FormatMessage<CompiledMessage>>;
declare namespace formatMessage {
    var raw: boolean;
}
export default formatMessage;
