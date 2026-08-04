import { describe, expect, it } from 'vitest';

import { formatSource, parseSource, scanSource } from '../src/index.js';

const syntaxShape = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (key, item: unknown) => (key === 'span' ? undefined : item)),
  ) as unknown;

describe('OXE trivia and formatter', () => {
  it('preserves ordered whitespace and comment trivia', () => {
    const result = scanSource('App():  // root\n  // state\n  value = 1\n', 'trivia.oxe');

    expect(result.trivia.map((item) => [item.kind, item.text])).toEqual([
      ['whitespace', '  '],
      ['comment', '// root'],
      ['whitespace', '  '],
      ['comment', '// state'],
      ['whitespace', '  '],
      ['whitespace', ' '],
      ['whitespace', ' '],
    ]);
    expect(result.trivia.every((item) => item.span.fileName === 'trivia.oxe')).toBe(true);
  });

  it('formats code spacing and line endings without changing syntax or comments', () => {
    const source =
      'App( ) :\r\n  // keep this comment\r\n  user={name:"Chris"}  // identity\r\n  names = [ "A","B" ].map( name => name )\r\n  <p>{user.name}\r\n';
    const result = formatSource(source, 'format.oxe');

    expect(result.diagnostics).toEqual([]);
    expect(result.formatted).toBe(`App():
  // keep this comment
  user = { name: "Chris" } // identity
  names = ["A", "B"].map(name => name)
  <p>{user.name}
`);
    expect(formatSource(result.formatted).formatted).toBe(result.formatted);
    expect(syntaxShape(parseSource(result.formatted).ast)).toEqual(
      syntaxShape(parseSource(source).ast),
    );
  });

  it('keeps choice punctuation atomic while formatting record results', () => {
    const source = `App( ) :
  visible=true
  view   =?
    visible? {name:"Chris"}
    : {name:"Guest"}
  <p>{view.name}
`;
    const result = formatSource(source, 'choice.oxe');

    expect(result.diagnostics).toEqual([]);
    expect(result.formatted).toBe(`App():
  visible = true
  view =?
    visible ? { name: "Chris" }
    : { name: "Guest" }
  <p>{view.name}
`);
    expect(formatSource(result.formatted).formatted).toBe(result.formatted);
    expect(syntaxShape(parseSource(result.formatted).ast)).toEqual(
      syntaxShape(parseSource(source).ast),
    );
  });

  it('returns invalid source unchanged with its diagnostics', () => {
    const source = 'App():\n value =\n';
    const result = formatSource(source);

    expect(result.changed).toBe(false);
    expect(result.formatted).toBe(source);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
