import type AbstractIntlMessages from './AbstractIntlMessages.js';
import IntlError from './IntlError.js';
export default function validateMessages(messages: AbstractIntlMessages, onError: (error: IntlError) => void): void;
