const TYPE_POUND = 0;
const TYPE_SELECT = 1;
const TYPE_PLURAL = 2;
const TYPE_SELECTORDINAL = 3;
const TYPE_NUMBER = 4;
const TYPE_DATE = 5;
const TYPE_TIME = 6;

// Plain text literal

// Simple argument reference: ["name"]

// Pound sign (#) - represents the number in plural contexts

// Select: ["name", TYPE_SELECT, {options}]

// Plural: ["name", TYPE_PLURAL, {options}]

// Select ordinal: ["name", TYPE_SELECTORDINAL, {options}]

// Number format: ["name", TYPE_NUMBER, style?]

// Date format: ["name", TYPE_DATE, style?]

// Time format: ["name", TYPE_TIME, style?]

// Tags have no type constant - detected at runtime by
// format: ["tagName", child1, child2, ...]

export { TYPE_POUND as T, TYPE_NUMBER as a, TYPE_DATE as b, TYPE_TIME as c, TYPE_SELECT as d, TYPE_SELECTORDINAL as e, TYPE_PLURAL as f };
