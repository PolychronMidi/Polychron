# po-parser

Parses and serializes `.po` file content.

Zero-dependency. ~2kb minified & gzipped.

## Usage

### Parse

```typescript
import POParser from 'po-parser';

const content = `
msgid ""
msgstr ""
"POT-Creation-Date: 2025-10-27 16:00+0000\n"

#: src/Greeting.tsx
#. Greets the user
msgid "+YJVTi"
msgstr "Hey"
`;

const result = POParser.parse(content);
```

### Serialize

```typescript
import POParser from 'po-parser';

const catalog = {
  meta: {
    'POT-Creation-Date': '2025-10-27 16:00+0000'
  },
  messages: [
    {
      msgid: '+YJVTi',
      msgstr: 'Hey',
      extractedComments: ['Greets the user'],
      references: [{path: 'src/Greeting.tsx', line: 10}]
    }
  ]
};

const result = POParser.serialize(catalog);
```

## Supported features

- `msgid` and `msgstr` (message entries)
- `msgctxt` (message context for namespacing)
- References (`#:` comments, with optional line numbers)
- Extracted comments (`#.` comments)
- Flag comments (`#,` comments, e.g. `#, fuzzy`)
- Metadata (from empty `msgid`/`msgstr` entry at the beginning)
- Single-line quoted strings

## Unsupported features

- Translator comments (`#` comments)
- Previous string key comments (`#|` comments)
- Plural forms (`msgid_plural`)
- Multi-line strings
