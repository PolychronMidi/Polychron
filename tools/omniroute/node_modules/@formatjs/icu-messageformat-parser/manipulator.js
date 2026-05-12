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
//#region packages/icu-messageformat-parser/manipulator.ts
function cloneDeep(obj) {
	if (Array.isArray(obj)) return obj.map(cloneDeep);
	if (obj !== null && typeof obj === "object") return Object.keys(obj).reduce((cloned, k) => {
		cloned[k] = cloneDeep(obj[k]);
		return cloned;
	}, {});
	return obj;
}
/**
* Replace pound elements with number elements referencing the given variable.
* This is needed when nesting plurals - the # in the outer plural should become
* an explicit variable reference when nested inside another plural.
* GH #4202
*/
function replacePoundWithArgument(ast, variableName) {
	return ast.map((el) => {
		if (isPoundElement(el)) return {
			type: TYPE.number,
			value: variableName,
			style: null,
			location: el.location
		};
		if (isPluralElement(el) || isSelectElement(el)) {
			const newOptions = {};
			for (const key of Object.keys(el.options)) newOptions[key] = { value: replacePoundWithArgument(el.options[key].value, variableName) };
			return {
				...el,
				options: newOptions
			};
		}
		if (isTagElement(el)) return {
			...el,
			children: replacePoundWithArgument(el.children, variableName)
		};
		return el;
	});
}
function hoistPluralOrSelectElement(ast, el, positionToInject) {
	const cloned = cloneDeep(el);
	const { options } = cloned;
	const afterElements = ast.slice(positionToInject + 1);
	const hasSubsequentPluralOrSelect = afterElements.some(isPluralOrSelectElement);
	cloned.options = Object.keys(options).reduce((all, k) => {
		let optionValue = options[k].value;
		if (hasSubsequentPluralOrSelect && isPluralElement(el)) optionValue = replacePoundWithArgument(optionValue, el.value);
		all[k] = { value: hoistSelectors([
			...ast.slice(0, positionToInject),
			...optionValue,
			...afterElements
		]) };
		return all;
	}, {});
	return cloned;
}
function isPluralOrSelectElement(el) {
	return isPluralElement(el) || isSelectElement(el);
}
function findPluralOrSelectElement(ast) {
	return !!ast.find((el) => {
		if (isPluralOrSelectElement(el)) return true;
		if (isTagElement(el)) return findPluralOrSelectElement(el.children);
		return false;
	});
}
/**
* Hoist all selectors to the beginning of the AST & flatten the
* resulting options. E.g:
* "I have {count, plural, one{a dog} other{many dogs}}"
* becomes "{count, plural, one{I have a dog} other{I have many dogs}}".
* If there are multiple selectors, the order of which one is hoisted 1st
* is non-deterministic.
* The goal is to provide as many full sentences as possible since fragmented
* sentences are not translator-friendly
* @param ast AST
*/
function hoistSelectors(ast) {
	for (let i = 0; i < ast.length; i++) {
		const el = ast[i];
		if (isPluralOrSelectElement(el)) return [hoistPluralOrSelectElement(ast, el, i)];
		if (isTagElement(el) && findPluralOrSelectElement([el])) throw new Error("Cannot hoist plural/select within a tag element. Please put the tag element inside each plural/select option");
	}
	return ast;
}
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
export { hoistSelectors, isStructurallySame };

//# sourceMappingURL=manipulator.js.map