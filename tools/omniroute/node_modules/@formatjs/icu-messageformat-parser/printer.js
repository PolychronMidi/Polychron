//#region packages/icu-messageformat-parser/types.ts
let TYPE = /* @__PURE__ */ function(TYPE) {
	/**
	* Raw text
	*/
	TYPE[TYPE["literal"] = 0] = "literal";
	/**
	* Variable w/o any format, e.g `var` in `this is a {var}`
	*/
	TYPE[TYPE["argument"] = 1] = "argument";
	/**
	* Variable w/ number format
	*/
	TYPE[TYPE["number"] = 2] = "number";
	/**
	* Variable w/ date format
	*/
	TYPE[TYPE["date"] = 3] = "date";
	/**
	* Variable w/ time format
	*/
	TYPE[TYPE["time"] = 4] = "time";
	/**
	* Variable w/ select format
	*/
	TYPE[TYPE["select"] = 5] = "select";
	/**
	* Variable w/ plural format
	*/
	TYPE[TYPE["plural"] = 6] = "plural";
	/**
	* Only possible within plural argument.
	* This is the `#` symbol that will be substituted with the count.
	*/
	TYPE[TYPE["pound"] = 7] = "pound";
	/**
	* XML-like tag
	*/
	TYPE[TYPE["tag"] = 8] = "tag";
	return TYPE;
}({});
let SKELETON_TYPE = /* @__PURE__ */ function(SKELETON_TYPE) {
	SKELETON_TYPE[SKELETON_TYPE["number"] = 0] = "number";
	SKELETON_TYPE[SKELETON_TYPE["dateTime"] = 1] = "dateTime";
	return SKELETON_TYPE;
}({});
/**
* Type Guards
*/
function isLiteralElement(el) {
	return el.type === TYPE.literal;
}
function isArgumentElement(el) {
	return el.type === TYPE.argument;
}
function isNumberElement(el) {
	return el.type === TYPE.number;
}
function isDateElement(el) {
	return el.type === TYPE.date;
}
function isTimeElement(el) {
	return el.type === TYPE.time;
}
function isSelectElement(el) {
	return el.type === TYPE.select;
}
function isPluralElement(el) {
	return el.type === TYPE.plural;
}
function isPoundElement(el) {
	return el.type === TYPE.pound;
}
function isTagElement(el) {
	return el.type === TYPE.tag;
}
//#endregion
//#region packages/icu-messageformat-parser/printer.ts
function printAST(ast) {
	return doPrintAST(ast, false);
}
function doPrintAST(ast, isInPlural) {
	return ast.map((el, i) => {
		if (isLiteralElement(el)) return printLiteralElement(el, isInPlural, i === 0, i === ast.length - 1);
		if (isArgumentElement(el)) return printArgumentElement(el);
		if (isDateElement(el) || isTimeElement(el) || isNumberElement(el)) return printSimpleFormatElement(el);
		if (isPluralElement(el)) return printPluralElement(el);
		if (isSelectElement(el)) return printSelectElement(el);
		if (isPoundElement(el)) return "#";
		if (isTagElement(el)) return printTagElement(el);
	}).join("");
}
function printTagElement(el) {
	return `<${el.value}>${printAST(el.children)}</${el.value}>`;
}
function printEscapedMessage(message) {
	return message.replace(/([{}](?:[\s\S]*[{}])?)/, `'$1'`);
}
function printLiteralElement({ value }, isInPlural, isFirstEl, isLastEl) {
	let escaped = value;
	if (!isFirstEl && escaped[0] === `'`) escaped = `''${escaped.slice(1)}`;
	if (!isLastEl && escaped[escaped.length - 1] === `'`) escaped = `${escaped.slice(0, escaped.length - 1)}''`;
	escaped = printEscapedMessage(escaped);
	return isInPlural ? escaped.replace("#", "'#'") : escaped;
}
function printArgumentElement({ value }) {
	return `{${value}}`;
}
function printSimpleFormatElement(el) {
	return `{${el.value}, ${TYPE[el.type]}${el.style ? `, ${printArgumentStyle(el.style)}` : ""}}`;
}
function printNumberSkeletonToken(token) {
	const { stem, options } = token;
	return options.length === 0 ? stem : `${stem}${options.map((o) => `/${o}`).join("")}`;
}
function printArgumentStyle(style) {
	if (typeof style === "string") return printEscapedMessage(style);
	else if (style.type === SKELETON_TYPE.dateTime) return `::${printDateTimeSkeleton(style)}`;
	else return `::${style.tokens.map(printNumberSkeletonToken).join(" ")}`;
}
function printDateTimeSkeleton(style) {
	return style.pattern;
}
function printSelectElement(el) {
	return `{${[
		el.value,
		"select",
		Object.keys(el.options).map((id) => `${id}{${doPrintAST(el.options[id].value, false)}}`).join(" ")
	].join(",")}}`;
}
function printPluralElement(el) {
	const type = el.pluralType === "cardinal" ? "plural" : "selectordinal";
	return `{${[
		el.value,
		type,
		[el.offset ? `offset:${el.offset}` : "", ...Object.keys(el.options).map((id) => `${id}{${doPrintAST(el.options[id].value, true)}}`)].filter(Boolean).join(" ")
	].join(",")}}`;
}
//#endregion
export { doPrintAST, printAST, printDateTimeSkeleton };

//# sourceMappingURL=printer.js.map