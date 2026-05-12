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
function isNumberSkeleton(el) {
	return !!(el && typeof el === "object" && el.type === SKELETON_TYPE.number);
}
function isDateTimeSkeleton(el) {
	return !!(el && typeof el === "object" && el.type === SKELETON_TYPE.dateTime);
}
function createLiteralElement(value) {
	return {
		type: TYPE.literal,
		value
	};
}
function createNumberElement(value, style) {
	return {
		type: TYPE.number,
		value,
		style
	};
}
//#endregion
//#region packages/icu-messageformat-parser/manipulator.ts
/**
* Collect all variables in an AST to Record<string, TYPE>
* @param ast AST to collect variables from
* @param vars Record of variable name to variable type
*/
function collectVariables(ast, vars = /* @__PURE__ */ new Map()) {
	ast.forEach((el) => {
		if (isArgumentElement(el) || isDateElement(el) || isTimeElement(el) || isNumberElement(el)) if (vars.has(el.value)) {
			const existingType = vars.get(el.value);
			if (existingType !== el.type && existingType !== TYPE.plural && existingType !== TYPE.select) throw new Error(`Variable ${el.value} has conflicting types`);
		} else vars.set(el.value, el.type);
		if (isPluralElement(el) || isSelectElement(el)) {
			vars.set(el.value, el.type);
			Object.keys(el.options).forEach((k) => {
				collectVariables(el.options[k].value, vars);
			});
		}
		if (isTagElement(el)) {
			vars.set(el.value, el.type);
			collectVariables(el.children, vars);
		}
	});
}
/**
* Check if 2 ASTs are structurally the same. This primarily means that
* they have the same variables with the same type
* @param a
* @param b
* @returns
*/
function isStructurallySame(a, b) {
	const aVars = /* @__PURE__ */ new Map();
	const bVars = /* @__PURE__ */ new Map();
	collectVariables(a, aVars);
	collectVariables(b, bVars);
	if (aVars.size !== bVars.size) return {
		success: false,
		error: /* @__PURE__ */ new Error(`Different number of variables: [${Array.from(aVars.keys()).join(", ")}] vs [${Array.from(bVars.keys()).join(", ")}]`)
	};
	return Array.from(aVars.entries()).reduce((result, [key, type]) => {
		if (!result.success) return result;
		const bType = bVars.get(key);
		if (bType == null) return {
			success: false,
			error: /* @__PURE__ */ new Error(`Missing variable ${key} in message`)
		};
		if (bType !== type) return {
			success: false,
			error: /* @__PURE__ */ new Error(`Variable ${key} has conflicting types: ${TYPE[type]} vs ${TYPE[bType]}`)
		};
		return result;
	}, { success: true });
}
//#endregion
//#region packages/icu-messageformat-parser/no-parser.ts
function parse() {
	throw new Error("You're trying to format an uncompiled message with react-intl without parser, please import from 'react-intl' instead");
}
const _Parser = void 0;
//#endregion
export { SKELETON_TYPE, TYPE, _Parser, createLiteralElement, createNumberElement, isArgumentElement, isDateElement, isDateTimeSkeleton, isLiteralElement, isNumberElement, isNumberSkeleton, isPluralElement, isPoundElement, isSelectElement, isStructurallySame, isTagElement, isTimeElement, parse };

//# sourceMappingURL=no-parser.js.map