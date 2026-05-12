import type { FormatMessage } from './types.js';
/**
 * Compiles and formats an ICU message at runtime using intl-messageformat.
 * This is the default implementation used when messages are not precompiled.
 */
declare function formatMessage(
/** The raw ICU message string (or precompiled message, though this implementation ignores precompilation) */
...[key, message, values, options]: Parameters<FormatMessage<string>>): ReturnType<FormatMessage<string>>;
declare namespace formatMessage {
    var raw: boolean;
}
export default formatMessage;
