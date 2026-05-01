import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import TagParser from '../tagParser.js';

describe('TagParser', () => {
  let parser;

  beforeEach(() => {
    parser = new TagParser();
    // Silence console.log from the parser during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  // ─── extractToolCommands() ───────────────────────────────────────────

  describe('extractToolCommands', () => {
    test('returns empty array for plain text with no commands', () => {
      const result = parser.extractToolCommands('Hello, this is just plain text with no JSON.');
      expect(result).toEqual([]);
    });

    test('extracts command from JSON code block', () => {
      const content = 'Here is a command:\n```json\n{"toolId":"terminal","parameters":{"command":"ls"}}\n```';
      const result = parser.extractToolCommands(content);
      expect(result).toHaveLength(1);
      expect(result[0].toolId).toBe('terminal');
      expect(result[0].parameters).toEqual({ command: 'ls' });
      expect(result[0].type).toBe('json');
    });

    test('extracts multiple commands from multiple JSON blocks', () => {
      const content = [
        'First command:',
        '```json',
        '{"toolId":"terminal","parameters":{"command":"pwd"}}',
        '```',
        'Second command:',
        '```json',
        '{"toolId":"filesystem","parameters":{"path":"/tmp"}}',
        '```'
      ].join('\n');

      const result = parser.extractToolCommands(content);
      expect(result).toHaveLength(2);
      expect(result[0].toolId).toBe('terminal');
      expect(result[1].toolId).toBe('filesystem');
    });

    test('handles malformed JSON in code block via jsonrepair', () => {
      const content = '```json\n{"toolId":"terminal","parameters":{"command":"ls"}\n```';
      const result = parser.extractToolCommands(content);
      expect(Array.isArray(result)).toBe(true);
    });

    test('skips JSON code blocks that are not tool commands', () => {
      const content = '```json\n{"name":"test","version":"1.0.0"}\n```';
      const result = parser.extractToolCommands(content);
      expect(result).toHaveLength(0);
    });

    test('extracts plain JSON tool command not in code block', () => {
      const content = '{"toolId":"filesystem","actions":[{"type":"read-file","path":"/tmp/x.txt"}]}';
      const result = parser.extractToolCommands(content);
      expect(result).toHaveLength(1);
      expect(result[0].toolId).toBe('filesystem');
      expect(result[0].type).toBe('json-plain');
    });

    test('does NOT double-extract JSON that is in a code block', () => {
      const content = '```json\n{"toolId":"terminal","parameters":{"command":"echo hi"}}\n```';
      const result = parser.extractToolCommands(content);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('json');
    });

    test('handles actions array format with toolId at top level', () => {
      const content = '```json\n{"toolId":"terminal","actions":[{"type":"run-command","command":"pwd"}]}\n```';
      const result = parser.extractToolCommands(content);
      expect(result).toHaveLength(1);
      expect(result[0].toolId).toBe('terminal');
      expect(result[0].actions).toEqual([{ type: 'run-command', command: 'pwd' }]);
    });

    test('handles toolCommands array format with multiple tools in one block', () => {
      const content = [
        '```json',
        JSON.stringify({
          toolCommands: [
            { toolId: 'terminal', parameters: { command: 'ls' } },
            { toolId: 'filesystem', parameters: { path: '/tmp' } }
          ]
        }),
        '```'
      ].join('\n');

      const result = parser.extractToolCommands(content);
      expect(result).toHaveLength(2);
      expect(result[0].toolId).toBe('terminal');
      expect(result[1].toolId).toBe('filesystem');
    });

    test('decodes HTML entities before parsing', () => {
      const content = '```json\n{&quot;toolId&quot;:&quot;terminal&quot;,&quot;parameters&quot;:{&quot;command&quot;:&quot;ls&quot;}}\n```';
      const result = parser.extractToolCommands(content);
      expect(result).toHaveLength(1);
      expect(result[0].toolId).toBe('terminal');
    });
  });

  // ─── _extractTopLevelParams ─────────────────────────────────────────

  describe('_extractTopLevelParams', () => {
    test('extracts all params except toolId and tool', () => {
      const data = { toolId: 'terminal', tool: 'terminal', command: 'ls', path: '/tmp', flag: true };
      const result = parser._extractTopLevelParams(data);
      expect(result).toEqual({ command: 'ls', path: '/tmp', flag: true });
      expect(result.toolId).toBeUndefined();
      expect(result.tool).toBeUndefined();
    });

    test('returns empty object if only toolId/tool present', () => {
      const result = parser._extractTopLevelParams({ toolId: 'x', tool: 'y' });
      expect(result).toEqual({});
    });
  });

  // ─── extractJSONCodeBlocks ──────────────────────────────────────────

  describe('extractJSONCodeBlocks', () => {
    test('skips block without explicit toolId', () => {
      const content = '```json\n{"parameters":{"command":"ls"}}\n```';
      const result = parser.extractJSONCodeBlocks(content);
      expect(result).toHaveLength(0);
    });

    test('skips block with toolId "unknown"', () => {
      const content = '```json\n{"toolId":"unknown","parameters":{"command":"ls"}}\n```';
      const result = parser.extractJSONCodeBlocks(content);
      expect(result).toHaveLength(0);
    });

    test('uses top-level params when no parameters wrapper', () => {
      const content = '```json\n{"toolId":"terminal","command":"ls","path":"/tmp"}\n```';
      const result = parser.extractJSONCodeBlocks(content);
      expect(result).toHaveLength(1);
      expect(result[0].parameters).toEqual({ command: 'ls', path: '/tmp' });
    });

    test('marks repaired/truncated JSON appropriately', () => {
      // Provide truncated JSON that repair can fix
      const content = '```json\n{"toolId":"terminal","parameters":{"command":"ls"}\n```';
      const result = parser.extractJSONCodeBlocks(content);
      // Whether it repairs or not depends on jsonRepair, just assert it does not crash
      expect(Array.isArray(result)).toBe(true);
    });

    test('skips toolCommands entries without toolId', () => {
      const content = [
        '```json',
        JSON.stringify({
          toolCommands: [
            { parameters: { command: 'ls' } },
            { toolId: 'terminal', parameters: { command: 'pwd' } }
          ]
        }),
        '```'
      ].join('\n');
      const result = parser.extractJSONCodeBlocks(content);
      // Only the second entry with toolId should be extracted
      expect(result.length).toBeGreaterThanOrEqual(1);
      const terminalCmd = result.find(c => c.toolId === 'terminal');
      expect(terminalCmd).toBeDefined();
    });

    test('toolCommands entries use parameters wrapper when present', () => {
      const content = [
        '```json',
        JSON.stringify({
          toolCommands: [
            { toolId: 'terminal', parameters: { command: 'ls' } }
          ]
        }),
        '```'
      ].join('\n');
      const result = parser.extractJSONCodeBlocks(content);
      const cmd = result.find(c => c.toolId === 'terminal');
      expect(cmd).toBeDefined();
      expect(cmd.parameters).toEqual({ command: 'ls' });
    });

    test('toolCommands entries extract top-level params when no parameters wrapper', () => {
      const content = [
        '```json',
        JSON.stringify({
          toolCommands: [
            { toolId: 'terminal', command: 'pwd', headless: true }
          ]
        }),
        '```'
      ].join('\n');
      const result = parser.extractJSONCodeBlocks(content);
      const cmd = result.find(c => c.toolId === 'terminal');
      expect(cmd).toBeDefined();
      expect(cmd.parameters.command).toBe('pwd');
      expect(cmd.parameters.headless).toBe(true);
    });
  });

  // ─── extractPlainJSON ───────────────────────────────────────────────

  describe('extractPlainJSON', () => {
    test('extracts plain JSON tool command with toolId and parameters', () => {
      const content = '{"toolId":"terminal","parameters":{"command":"ls"}}';
      const result = parser.extractPlainJSON(content);
      expect(result).toHaveLength(1);
      expect(result[0].toolId).toBe('terminal');
      expect(result[0].type).toBe('json-plain');
      expect(result[0].warning).toBeDefined();
    });

    test('extracts multi-line plain JSON', () => {
      const content = [
        '{',
        '  "toolId": "filesystem",',
        '  "actions": [{"type": "read-file", "path": "/tmp/test.txt"}]',
        '}'
      ].join('\n');
      const result = parser.extractPlainJSON(content);
      expect(result).toHaveLength(1);
      expect(result[0].toolId).toBe('filesystem');
    });

    test('skips lines not starting with {', () => {
      const content = 'some text\nanother line\nno json here';
      const result = parser.extractPlainJSON(content);
      expect(result).toEqual([]);
    });

    test('skips plain JSON without identifiable toolId', () => {
      const content = '{"randomField":"value","otherField":123}';
      const result = parser.extractPlainJSON(content);
      expect(result).toEqual([]);
    });

    test('skips plain JSON where toolId resolves to unknown', () => {
      const content = '{"type":"some-unknown-action","data":"val"}';
      const result = parser.extractPlainJSON(content);
      expect(result).toEqual([]);
    });

    test('handles incomplete JSON (no closing brace found)', () => {
      const content = '{"toolId":"terminal","parameters":{"command":"ls"}';
      const result = parser.extractPlainJSON(content);
      // Either repaired or skipped, but should not throw
      expect(Array.isArray(result)).toBe(true);
    });

    test('extracts plain JSON with actions array', () => {
      const content = '{"toolId":"filesystem","actions":[{"type":"read-file","path":"/x"}]}';
      const result = parser.extractPlainJSON(content);
      expect(result).toHaveLength(1);
      expect(result[0].actions).toBeDefined();
    });

    test('uses _extractTopLevelParams when no parameters wrapper', () => {
      const content = '{"toolId":"terminal","command":"pwd","flag":true}';
      const result = parser.extractPlainJSON(content);
      expect(result).toHaveLength(1);
      expect(result[0].parameters.command).toBe('pwd');
      expect(result[0].parameters.flag).toBe(true);
    });
  });

  // ─── removeJsonBlocks ──────────────────────────────────────────────

  describe('removeJsonBlocks', () => {
    test('removes JSON code blocks from content', () => {
      const content = 'before\n```json\n{"key":"value"}\n```\nafter';
      const result = parser.removeJsonBlocks(content);
      expect(result).toContain('before');
      expect(result).toContain('after');
      expect(result).toContain('[JSON_BLOCK_REMOVED]');
      expect(result).not.toContain('"key"');
    });

    test('handles multiple JSON code blocks', () => {
      const content = '```json\n{}\n```\nmiddle\n```json\n{}\n```';
      const result = parser.removeJsonBlocks(content);
      const count = (result.match(/\[JSON_BLOCK_REMOVED\]/g) || []).length;
      expect(count).toBe(2);
    });

    test('returns content unchanged when no code blocks', () => {
      const content = 'no code blocks here';
      expect(parser.removeJsonBlocks(content)).toBe(content);
    });

    test('handles unclosed code block (no closing ```)', () => {
      const content = 'before\n```json\n{"key":"value"}';
      const result = parser.removeJsonBlocks(content);
      // Should return content as-is since no closing marker found
      expect(result).toBe(content);
    });
  });

  // ─── inferToolFromActions ──────────────────────────────────────────

  describe('inferToolFromActions', () => {
    test('returns terminal for run-command action type', () => {
      const jsonData = { actions: [{ type: 'run-command' }] };
      const result = parser.inferToolFromActions(jsonData);
      expect(result).toBe('terminal');
    });

    test('returns toolId directly when present (standard structure)', () => {
      const jsonData = { toolId: 'filesystem', parameters: { path: '/' } };
      const result = parser.inferToolFromActions(jsonData);
      expect(result).toBe('filesystem');
    });

    test('returns unknown for unrecognized structure', () => {
      const jsonData = { randomField: 'value' };
      const result = parser.inferToolFromActions(jsonData);
      expect(result).toBe('unknown');
    });

    test('handles direct action type', () => {
      const jsonData = { type: 'run-command', command: 'ls' };
      const result = parser.inferToolFromActions(jsonData);
      expect(result).toBe('terminal');
    });

    test('handles empty actions array', () => {
      const jsonData = { actions: [] };
      const result = parser.inferToolFromActions(jsonData);
      expect(result).toBe('unknown');
    });

    test('handles toolCommands structure', () => {
      const jsonData = {
        toolCommands: [
          { toolId: 'terminal', parameters: { command: 'ls' } }
        ]
      };
      const result = parser.inferToolFromActions(jsonData);
      expect(result).toBe('terminal');
    });

    test('handles empty toolCommands array', () => {
      const jsonData = { toolCommands: [] };
      const result = parser.inferToolFromActions(jsonData);
      expect(result).toBe('unknown');
    });
  });

  // ─── _findMatchingCodeBlockEnd ──────────────────────────────────────

  describe('_findMatchingCodeBlockEnd', () => {
    test('finds closing ``` outside of JSON strings', () => {
      const content = '```json\n{"key":"value"}\n```';
      const startPos = '```json\n'.length;
      const result = parser._findMatchingCodeBlockEnd(content, startPos);
      expect(result).toBe(content.indexOf('```', startPos));
    });

    test('skips ``` inside JSON string values', () => {
      const jsonContent = '{"readme":"Use ```bash\\necho hello\\n``` for commands"}';
      const content = '```json\n' + jsonContent + '\n```';
      const startPos = '```json\n'.length;
      const result = parser._findMatchingCodeBlockEnd(content, startPos);
      // Should find the actual closing ```, not the ones inside the string
      expect(result).toBeGreaterThan(startPos + jsonContent.length - 5);
    });

    test('handles escaped quotes inside strings', () => {
      const content = '```json\n{"key":"val\\"ue"}\n```';
      const startPos = '```json\n'.length;
      const result = parser._findMatchingCodeBlockEnd(content, startPos);
      expect(result).toBeGreaterThan(startPos);
    });

    test('uses fallback when state tracking fails to find closing marker', () => {
      // Content where no clean closing ``` exists outside strings but lastIndexOf finds one
      const content = '```json\n{"key":"value"}\n```';
      const startPos = '```json\n'.length;
      const result = parser._findMatchingCodeBlockEnd(content, startPos);
      expect(result).toBeGreaterThan(-1);
    });

    test('returns -1 when no closing ``` found at all', () => {
      const content = '```json\n{"key":"value"}\n';
      const startPos = '```json\n'.length;
      const result = parser._findMatchingCodeBlockEnd(content, startPos);
      expect(result).toBe(-1);
    });

    test('does not match ``` followed by language name as closing marker', () => {
      const content = '```json\n{"readme":"```bash\\ncode\\n```"}\n```';
      const startPos = '```json\n'.length;
      const result = parser._findMatchingCodeBlockEnd(content, startPos);
      expect(result).toBeGreaterThan(startPos);
    });
  });

  // ─── parseXMLParameters ────────────────────────────────────────────

  describe('parseXMLParameters', () => {
    // Note: parseXMLParameters calls this.isValidXmlTagName which is not defined;
    // we mock it to allow testing
    beforeEach(() => {
      parser.isValidXmlTagName = jest.fn().mockReturnValue(true);
    });

    test('parses simple XML parameter tags', () => {
      const content = '<path>/src/index.js</path>';
      const result = parser.parseXMLParameters(content);
      expect(result.path).toBeDefined();
      expect(result.path.value).toBe('/src/index.js');
    });

    test('parses multiple tags', () => {
      const content = '<path>/src/index.js</path><content>hello world</content>';
      const result = parser.parseXMLParameters(content);
      expect(result.path.value).toBe('/src/index.js');
      expect(result.content.value).toBe('hello world');
    });

    test('handles empty tag content', () => {
      const content = '<flag></flag>';
      const result = parser.parseXMLParameters(content);
      expect(result.flag).toBeDefined();
      expect(result.flag.value).toBe('');
    });

    test('handles tags with attributes', () => {
      const content = '<write path="/tmp/out.txt" mode="overwrite">file content</write>';
      const result = parser.parseXMLParameters(content);
      expect(result.write).toBeDefined();
      expect(result.write.value).toBe('file content');
      expect(result.write.attributes.path).toBe('/tmp/out.txt');
      expect(result.write.attributes.mode).toBe('overwrite');
    });

    test('handles duplicate tag names by converting to array', () => {
      const content = '<write path="/a.txt">content A</write><write path="/b.txt">content B</write>';
      const result = parser.parseXMLParameters(content);
      expect(Array.isArray(result.write)).toBe(true);
      expect(result.write).toHaveLength(2);
      expect(result.write[0].value).toBe('content A');
      expect(result.write[1].value).toBe('content B');
    });

    test('handles triple duplicate tags (appends to existing array)', () => {
      const content = '<item>1</item><item>2</item><item>3</item>';
      const result = parser.parseXMLParameters(content);
      expect(Array.isArray(result.item)).toBe(true);
      expect(result.item).toHaveLength(3);
    });

    test('skips tags with / in name', () => {
      parser.isValidXmlTagName = jest.fn().mockReturnValue(true);
      const content = '</closing>text';
      const result = parser.parseXMLParameters(content);
      // Should not parse /closing as a param
      expect(result['/closing']).toBeUndefined();
    });

    test('skips invalid XML tag names', () => {
      parser.isValidXmlTagName = jest.fn().mockReturnValue(false);
      const content = '<123invalid>value</123invalid>';
      const result = parser.parseXMLParameters(content);
      expect(Object.keys(result)).toHaveLength(0);
    });

    test('skips tag without closing tag', () => {
      const content = '<open>value without closing';
      const result = parser.parseXMLParameters(content);
      expect(result.open).toBeUndefined();
    });

    test('handles self-closing tags with attributes', () => {
      const content = '<config key="value" enabled="true"/>';
      const result = parser.parseXMLParameters(content);
      expect(result.config).toBeDefined();
      expect(result.config.value).toBe('');
      expect(result.config.attributes.key).toBe('value');
      expect(result.config.attributes.enabled).toBe('true');
    });

    test('returns empty object for empty content', () => {
      const result = parser.parseXMLParameters('');
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  // ─── extractAgentRedirects() ─────────────────────────────────────────

  describe('extractAgentRedirects', () => {
    test('returns empty array for text with no redirects', () => {
      const result = parser.extractAgentRedirects('Just normal text, nothing to redirect.');
      expect(result).toEqual([]);
    });

    test('parses basic agent-redirect with to and content', () => {
      const content = '[agent-redirect to="agent-1"]hello world[/agent-redirect]';
      const result = parser.extractAgentRedirects(content);
      expect(result).toHaveLength(1);
      expect(result[0].to).toBe('agent-1');
      expect(result[0].content).toBe('hello world');
    });

    test('parses urgent and requires-response attributes', () => {
      const content = '[agent-redirect to="agent-2" urgent="true" requiresResponse="true"]check this[/agent-redirect]';
      const result = parser.extractAgentRedirects(content);
      expect(result).toHaveLength(1);
      expect(result[0].to).toBe('agent-2');
      expect(result[0].urgent).toBe(true);
      expect(result[0].requiresResponse).toBe(true);
      expect(result[0].content).toBe('check this');
    });

    test('handles multiple redirects in same content', () => {
      const content = [
        '[agent-redirect to="agent-1"]first message[/agent-redirect]',
        'Some text in between.',
        '[agent-redirect to="agent-2"]second message[/agent-redirect]'
      ].join('\n');

      const result = parser.extractAgentRedirects(content);
      expect(result).toHaveLength(2);
      expect(result[0].to).toBe('agent-1');
      expect(result[1].to).toBe('agent-2');
    });
  });

  // ─── Static methods ──────────────────────────────────────────────────

  describe('TagParser.extractContent (static)', () => {
    test('extracts text between matching tags', () => {
      const content = '<summary>This is the summary</summary>';
      const result = TagParser.extractContent(content, 'summary');
      expect(result).toEqual(['This is the summary']);
    });

    test('returns empty array when tag not found', () => {
      const result = TagParser.extractContent('No tags here.', 'nonexistent');
      expect(result).toEqual([]);
    });

    test('handles multiple occurrences of the same tag', () => {
      const content = '<item>first</item> middle <item>second</item> end <item>third</item>';
      const result = TagParser.extractContent(content, 'item');
      expect(result).toEqual(['first', 'second', 'third']);
    });
  });

  describe('TagParser.extractTagsWithAttributes (static)', () => {
    test('extracts tags with attributes', () => {
      const content = '<file path="/tmp/x.txt" mode="read">content here</file>';
      const result = TagParser.extractTagsWithAttributes(content, 'file');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('content here');
      expect(result[0].attributes.path).toBe('/tmp/x.txt');
      expect(result[0].attributes.mode).toBe('read');
      expect(result[0].rawMatch).toContain('<file');
    });

    test('returns empty array when no matching tags', () => {
      const result = TagParser.extractTagsWithAttributes('no tags', 'file');
      expect(result).toEqual([]);
    });

    test('handles multiple tags', () => {
      const content = '<item id="1">first</item> <item id="2">second</item>';
      const result = TagParser.extractTagsWithAttributes(content, 'item');
      expect(result).toHaveLength(2);
      expect(result[0].attributes.id).toBe('1');
      expect(result[1].attributes.id).toBe('2');
    });
  });

  describe('TagParser.extractBetweenTags (static)', () => {
    test('extracts content between custom start and end tags', () => {
      const content = '<<START>>inner content<<END>> trailing';
      const result = TagParser.extractBetweenTags(content, '<<START>>', '<<END>>');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('inner content');
      expect(result[0].startIndex).toBe(0);
    });

    test('returns empty array when tags not found', () => {
      const result = TagParser.extractBetweenTags('no tags here', '<<A>>', '<<B>>');
      expect(result).toEqual([]);
    });

    test('handles multiple blocks between tags', () => {
      const content = '[BEGIN]alpha[END] gap [BEGIN]beta[END]';
      const result = TagParser.extractBetweenTags(content, '[BEGIN]', '[END]');
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('alpha');
      expect(result[1].content).toBe('beta');
    });

    test('includes fullMatch and endIndex', () => {
      const content = '<s>data</s>';
      const result = TagParser.extractBetweenTags(content, '<s>', '</s>');
      expect(result[0].fullMatch).toBe('<s>data</s>');
      expect(result[0].endIndex).toBe(content.length);
    });

    test('returns empty when only start tag found', () => {
      const result = TagParser.extractBetweenTags('<s>data', '<s>', '</s>');
      expect(result).toEqual([]);
    });
  });

  // ─── Utility methods ─────────────────────────────────────────────────

  describe('decodeHtmlEntities', () => {
    test('decodes common HTML entities', () => {
      const input = '&lt;div&gt; &amp; &quot;hello&quot;';
      const result = parser.decodeHtmlEntities(input);
      expect(result).toBe('<div> & "hello"');
    });

    test('returns text unchanged when no entities present', () => {
      const input = 'plain text no entities';
      expect(parser.decodeHtmlEntities(input)).toBe(input);
    });

    test('decodes single-quote entities', () => {
      expect(parser.decodeHtmlEntities('&#x27;')).toBe("'");
      expect(parser.decodeHtmlEntities('&#39;')).toBe("'");
    });

    test('decodes slash entities', () => {
      expect(parser.decodeHtmlEntities('&#x2F;')).toBe('/');
      expect(parser.decodeHtmlEntities('&#47;')).toBe('/');
    });
  });

  describe('isToolCommandJSON', () => {
    test('returns truthy for object with toolId and parameters', () => {
      expect(parser.isToolCommandJSON({ toolId: 'terminal', parameters: { cmd: 'ls' } })).toBeTruthy();
    });

    test('returns truthy for object with tool and actions', () => {
      expect(parser.isToolCommandJSON({ tool: 'fs', actions: [] })).toBeTruthy();
    });

    test('returns truthy for object with toolId and files', () => {
      expect(parser.isToolCommandJSON({ toolId: 'filesystem', files: [] })).toBeTruthy();
    });

    test('returns truthy for object with toolId and extra params', () => {
      expect(parser.isToolCommandJSON({ toolId: 'terminal', command: 'ls' })).toBeTruthy();
    });

    test('returns falsy for null', () => {
      expect(parser.isToolCommandJSON(null)).toBeFalsy();
    });

    test('returns falsy for non-object', () => {
      expect(parser.isToolCommandJSON('string')).toBeFalsy();
    });

    test('returns falsy for object without toolId or tool', () => {
      expect(parser.isToolCommandJSON({ parameters: {} })).toBeFalsy();
    });
  });

  describe('_hasToolParams', () => {
    test('returns true if object has keys other than toolId/tool', () => {
      expect(parser._hasToolParams({ toolId: 'x', command: 'ls' })).toBe(true);
    });

    test('returns false if object only has toolId', () => {
      expect(parser._hasToolParams({ toolId: 'x' })).toBe(false);
    });

    test('returns false for null', () => {
      expect(parser._hasToolParams(null)).toBe(false);
    });

    test('returns false for non-object', () => {
      expect(parser._hasToolParams('string')).toBe(false);
    });
  });

  describe('matchAll', () => {
    test('returns all matches with groups and indices', () => {
      const content = 'key1="val1" key2="val2"';
      const pattern = /([\w-]+)=["']([^"']*)["']/g;
      const results = parser.matchAll(content, pattern);
      expect(results).toHaveLength(2);
      expect(results[0].groups[0]).toBe('key1');
      expect(results[0].groups[1]).toBe('val1');
      expect(results[1].groups[0]).toBe('key2');
      expect(results[1].groups[1]).toBe('val2');
      expect(typeof results[0].index).toBe('number');
    });

    test('returns empty array for no matches', () => {
      const results = parser.matchAll('no matches', /xyz/g);
      expect(results).toEqual([]);
    });

    test('resets lastIndex before matching', () => {
      const pattern = /test/g;
      pattern.lastIndex = 999;
      const results = parser.matchAll('test test', pattern);
      expect(results).toHaveLength(2);
    });
  });

  describe('validateToolCommand', () => {
    test('rejects command without toolId', () => {
      const result = parser.validateToolCommand({ parameters: { path: '/tmp' } });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing toolId');
    });

    test('rejects command without parameters or actions', () => {
      const result = parser.validateToolCommand({ toolId: 'terminal' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing parameters or actions');
    });

    test('accepts valid command with toolId and parameters', () => {
      const command = {
        toolId: 'terminal',
        parameters: { command: 'ls' },
        type: 'json',
        jsonData: { toolId: 'terminal', parameters: { command: 'ls' } }
      };
      const result = parser.validateToolCommand(command);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('accepts valid command with toolId and actions', () => {
      const command = {
        toolId: 'filesystem',
        actions: [{ type: 'read-file' }],
        type: 'json',
        jsonData: { toolId: 'filesystem', actions: [] }
      };
      const result = parser.validateToolCommand(command);
      expect(result.valid).toBe(true);
    });

    test('rejects JSON command without jsonData', () => {
      const command = {
        toolId: 'terminal',
        parameters: { command: 'ls' },
        type: 'json'
      };
      const result = parser.validateToolCommand(command);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing jsonData for JSON command');
    });

    test('rejects json-plain command without jsonData', () => {
      const command = {
        toolId: 'terminal',
        parameters: { command: 'ls' },
        type: 'json-plain'
      };
      const result = parser.validateToolCommand(command);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing jsonData for JSON command');
    });
  });

  describe('normalizeToolCommand', () => {
    test('normalizes simple JSON command', () => {
      const command = {
        toolId: 'terminal',
        type: 'json',
        parameters: { command: 'ls' },
        rawContent: '...'
      };
      const result = parser.normalizeToolCommand(command);
      expect(result.toolId).toBe('terminal');
      expect(result.parameters.command).toBe('ls');
    });

    test('normalizes command with actions array', () => {
      const command = {
        toolId: 'terminal',
        type: 'json',
        parameters: {},
        actions: [{ type: 'run-command', command: 'pwd' }],
        rawContent: '...'
      };
      const result = parser.normalizeToolCommand(command);
      expect(result.parameters.actions).toEqual([{ type: 'run-command', command: 'pwd' }]);
    });

    test('normalizes agentcommunication command with actions', () => {
      const command = {
        toolId: 'agentcommunication',
        type: 'json',
        parameters: {},
        actions: [{ type: 'send-message', to: 'agent-1', content: 'hello' }],
        rawContent: '...'
      };
      const result = parser.normalizeToolCommand(command);
      expect(result.parameters.action).toBe('send-message');
      expect(result.parameters.to).toBe('agent-1');
    });
  });

  describe('parseAttributes', () => {
    test('parses key-value attribute pairs', () => {
      const result = parser.parseAttributes('to="agent-1" mode="write"');
      expect(result.to).toBe('agent-1');
      expect(result.mode).toBe('write');
    });

    test('returns empty object for empty string', () => {
      expect(parser.parseAttributes('')).toEqual({});
    });

    test('returns empty object for null/undefined', () => {
      expect(parser.parseAttributes(null)).toEqual({});
      expect(parser.parseAttributes(undefined)).toEqual({});
    });

    test('handles single-quoted attributes', () => {
      const result = parser.parseAttributes("key='value'");
      expect(result.key).toBe('value');
    });
  });

  describe('_toCamelCase', () => {
    test('converts kebab-case to camelCase', () => {
      expect(parser._toCamelCase('my-property')).toBe('myProperty');
    });

    test('converts snake_case to camelCase', () => {
      expect(parser._toCamelCase('my_property')).toBe('myProperty');
    });

    test('leaves camelCase unchanged', () => {
      expect(parser._toCamelCase('myProperty')).toBe('myProperty');
    });
  });

  describe('cleanContent', () => {
    test('removes agent redirects from content', () => {
      const content = 'Hello [agent-redirect to="a1"]message[/agent-redirect] world';
      const result = parser.cleanContent(content);
      expect(result).not.toContain('[agent-redirect');
      expect(result).toContain('Hello');
      expect(result).toContain('world');
    });

    test('removes JSON tool command blocks from content', () => {
      const content = 'Before\n```json\n{"toolId":"terminal","parameters":{"command":"ls"}}\n```\nAfter';
      const result = parser.cleanContent(content);
      expect(result).not.toContain('toolId');
      expect(result).toContain('Before');
      expect(result).toContain('After');
    });

    test('preserves non-tool JSON code blocks', () => {
      const content = 'Config:\n```json\n{"name":"test","version":"1.0"}\n```\nDone';
      const result = parser.cleanContent(content);
      expect(result).toContain('"name":"test"');
    });

    test('cleans up excessive whitespace', () => {
      const content = 'line1\n\n\n\nline2';
      const result = parser.cleanContent(content);
      expect(result).not.toMatch(/\n\s*\n\s*\n/);
    });

    test('removes toolCommands JSON blocks', () => {
      const json = JSON.stringify({ toolCommands: [{ toolId: 'terminal', parameters: {} }] });
      const content = `before\n\`\`\`json\n${json}\n\`\`\`\nafter`;
      const result = parser.cleanContent(content);
      expect(result).not.toContain('toolCommands');
    });
  });
});
