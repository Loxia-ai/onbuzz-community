/** Malformed JSON strings for testing parsers and repair functions */

export const validJson = '{"name": "test", "value": 42}';
export const validJsonArray = '[1, 2, 3]';
export const emptyObject = '{}';
export const emptyArray = '[]';

// Truncated
export const truncatedObject = '{"name": "test", "nested": {"key": "val';
export const truncatedArray = '[1, 2, 3, {"name": "test"';
export const truncatedString = '{"message": "hello wor';

// Trailing commas
export const trailingCommaObject = '{"a": 1, "b": 2,}';
export const trailingCommaArray = '[1, 2, 3,]';
export const trailingCommaNestedObject = '{"a": {"b": 1,}, "c": [1, 2,],}';

// Missing quotes
export const unquotedKeys = '{name: "test", value: 42}';

// Extra content
export const jsonWithTrailingText = '{"name": "test"} some extra text';

// Single quotes
export const singleQuotes = "{'name': 'test', 'value': 42}";

// Not JSON at all
export const plainText = 'This is just plain text, not JSON at all.';
export const htmlContent = '<html><body><p>Not JSON</p></body></html>';
export const emptyString = '';
export const whitespaceOnly = '   \n\t  ';
