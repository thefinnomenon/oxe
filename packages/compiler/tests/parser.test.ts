import { describe, expect, it } from 'vitest';

import {
  parseSource,
  type ComponentDeclarationNode,
  type ParseResult,
  type SourceSpan,
} from '../src/index.js';

const parseOnlyComponent = (
  source: string,
  fileName = 'test.oxe',
): { component: ComponentDeclarationNode; result: ParseResult } => {
  const result = parseSource(source, fileName);
  const component = result.ast.declarations[0];
  if (!component) {
    throw new Error('Expected the parser to produce one component.');
  }
  return { component, result };
};

const sourceSpan = (
  fileName: string,
  start: [offset: number, line: number, column: number],
  end: [offset: number, line: number, column: number],
): SourceSpan => ({
  fileName,
  start: { offset: start[0], line: start[1], column: start[2] },
  end: { offset: end[0], line: end[1], column: end[2] },
});

describe('OXE parser', () => {
  it('parses top-level context declarations as distinct module syntax', () => {
    const result = parseSource(`SessionContext = createContext()

App():
  <main>
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.ast.contexts).toMatchObject([
      { kind: 'ContextDeclaration', name: { name: 'SessionContext' } },
    ]);
    expect(result.ast.declarations).toHaveLength(1);
  });

  it('parses inline guards and standalone multi-branch conditional choices', () => {
    const { component, result } = parseOnlyComponent(`App():
  visible = true
  <main>
    visible ? <strong>Visible : <p>Hidden
    ?
      visible ? <section>
        <p>Primary
      : <p>Fallback
`);

    expect(result.diagnostics).toEqual([]);
    expect(component.body[1]).toMatchObject({
      kind: 'Element',
      children: [
        {
          kind: 'ConditionalRegion',
          branches: [
            {
              kind: 'ConditionalBranch',
              condition: { kind: 'Identifier', name: 'visible' },
              result: { kind: 'Element', name: { name: 'strong' } },
            },
            {
              kind: 'ConditionalBranch',
              result: { kind: 'Element', name: { name: 'p' } },
            },
          ],
        },
        {
          kind: 'ConditionalRegion',
          branches: [
            {
              condition: { kind: 'Identifier', name: 'visible' },
              result: { kind: 'Element', name: { name: 'section' } },
            },
            { result: { kind: 'Element', name: { name: 'p' } } },
          ],
        },
      ],
    });
  });

  it('keeps ordinary colons in inline branch text and recognizes only : followed by a fallback element', () => {
    const { component, result } = parseOnlyComponent(`App():
  visible = true
  <main>
    visible ? <strong>Status: Visible : <p>Status: Hidden
`);

    expect(result.diagnostics).toEqual([]);
    expect(component.body[1]).toMatchObject({
      kind: 'Element',
      children: [
        {
          kind: 'ConditionalRegion',
          branches: [
            {
              condition: { name: 'visible' },
              result: { children: [{ kind: 'Text', value: 'Status: Visible ' }] },
            },
            {
              result: { children: [{ kind: 'Text', value: 'Status: Hidden' }] },
            },
          ],
        },
      ],
    });
  });

  it('diagnoses the retired conditional arrow with migration guidance', () => {
    const result = parseSource(`App():
  visible = true
  <main>
    visible => <strong>Visible
`);

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OXE1101',
        message:
          'Expected ? after the conditional condition. => is reserved for functions and callbacks.',
      }),
    );
  });

  it('diagnoses the removed if keyword with migration guidance', () => {
    const result = parseSource(`App():
  visible = true
  <main>
    if
      visible ? <strong>Visible
`);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OXE1105',
        message:
          'The if keyword was removed. Write a single condition directly, or replace a multi-branch if opener with ?.',
      }),
    ]);
  });

  it('parses exhaustive inline and indented conditional values', () => {
    const { component, result } = parseOnlyComponent(`App():
  visible = true
  inline = visible ? "Visible" : "Hidden"
  choice =?
    visible ? "Visible"
    : "Hidden"
  <main>
    <p>{inline}: {choice}
`);

    expect(result.diagnostics).toEqual([]);
    expect(component.body[1]).toMatchObject({
      kind: 'AssignmentStatement',
      value: {
        kind: 'ConditionalValueExpression',
        branches: [
          {
            kind: 'ConditionalValueBranch',
            condition: { kind: 'Identifier', name: 'visible' },
            result: { kind: 'StringLiteral', value: 'Visible' },
          },
          {
            kind: 'ConditionalValueBranch',
            result: { kind: 'StringLiteral', value: 'Hidden' },
          },
        ],
      },
    });
    expect(component.body[2]).toMatchObject({
      kind: 'AssignmentStatement',
      value: {
        kind: 'ConditionalValueExpression',
        branches: [
          {
            condition: { kind: 'Identifier', name: 'visible' },
            result: { kind: 'StringLiteral', value: 'Visible' },
          },
          { result: { kind: 'StringLiteral', value: 'Hidden' } },
        ],
      },
    });
  });

  it('requires an exhaustive fallback for every value-producing conditional', () => {
    const inline = parseSource(`App():
  visible = true
  label = visible ? "Visible"
  <p>{label}
`);
    const choice = parseSource(`App():
  visible = true
  label =?
    visible ? "Visible"
  <p>{label}
`);

    expect(inline.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OXE1105',
        message: 'A value-producing inline conditional requires a : fallback.',
      }),
    );
    expect(choice.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OXE1105',
        message: 'A value-producing choice must end with a : fallback.',
      }),
    );
  });

  it('parses array values and concise markup-producing map callbacks', () => {
    const { component, result } = parseOnlyComponent(`App():
  items = ["A", "B"]
  <ul>
    {items.map(item => <li key={item}>{item})}
`);

    expect(result.diagnostics).toEqual([]);
    expect(component.body[0]).toMatchObject({
      kind: 'AssignmentStatement',
      value: {
        kind: 'ArrayLiteral',
        elements: [
          { kind: 'StringLiteral', value: 'A' },
          { kind: 'StringLiteral', value: 'B' },
        ],
      },
    });
    expect(component.body[1]).toMatchObject({
      kind: 'Element',
      children: [
        {
          kind: 'Interpolation',
          expression: {
            kind: 'MapExpression',
            collection: { kind: 'Identifier', name: 'items' },
            parameter: { name: 'item' },
            body: {
              kind: 'Element',
              name: { name: 'li' },
              attributes: [{ name: { name: 'key' }, value: { name: 'item' } }],
            },
          },
        },
      ],
    });
  });

  it('parses records, member access, ordinary calls, and multiline collection callbacks', () => {
    const { component, result } = parseOnlyComponent(`App(transform):
  user = { name: "Chris", active: true }
  label = transform(user.name)
  active = [user].filter(item => item.active)
  cards = active.map(item =>
    title = item.name
    { title: title, active: item.active }
  )
  total = [1, 2].reduce((sum, value) => sum + value, 0)
  <p>{label}: {cards.length}: {total}
`);

    expect(result.diagnostics).toEqual([]);
    expect(component.body).toMatchObject([
      {
        kind: 'AssignmentStatement',
        value: {
          kind: 'RecordLiteral',
          entries: [
            { name: { name: 'name' }, value: { kind: 'StringLiteral' } },
            { name: { name: 'active' }, value: { kind: 'BooleanLiteral' } },
          ],
        },
      },
      {
        value: {
          kind: 'CallExpression',
          arguments: [
            { kind: 'MemberExpression', object: { name: 'user' }, property: { name: 'name' } },
          ],
        },
      },
      { value: { kind: 'CollectionExpression', operation: 'filter' } },
      {
        value: {
          kind: 'CollectionExpression',
          operation: 'map',
          callback: {
            assignments: [{ target: { name: 'title' } }],
            result: { kind: 'RecordLiteral' },
          },
        },
      },
      { value: { kind: 'CollectionExpression', operation: 'reduce' } },
      { kind: 'Element' },
    ]);
  });

  it('parses record writes and the complete collection mutation surface', () => {
    const { component, result } = parseOnlyComponent(`App():
  users = [{ id: 1, name: "Ada", active: false }]
  ordered = users.sort(user => user.name, { descending: true })
  edit():
    users.add({ id: 2, name: "Lin", active: true })
    users.update(user => user.id == 1, user =>
      user.name = "Grace"
      user.active = true
    )
    users.remove(user => user.active == false, 1)
  rename():
    users.update(
      user => user.id == 1,
      user =>
        user.name = "Chris"
      ,
      1
    )
  <p>{ordered.length}
`);

    expect(result.diagnostics).toEqual([]);
    expect(component.body).toMatchObject([
      { kind: 'AssignmentStatement' },
      {
        kind: 'AssignmentStatement',
        value: {
          kind: 'CollectionExpression',
          operation: 'sort',
          options: { kind: 'RecordLiteral' },
        },
      },
      {
        kind: 'HandlerDeclaration',
        body: [
          { kind: 'CollectionMutationStatement', operation: 'add' },
          {
            kind: 'CollectionMutationStatement',
            operation: 'update',
            updater: {
              assignments: [
                { target: { kind: 'MemberExpression', property: { name: 'name' } } },
                { target: { kind: 'MemberExpression', property: { name: 'active' } } },
              ],
            },
          },
          { kind: 'CollectionMutationStatement', operation: 'remove', limit: { value: 1 } },
        ],
      },
      {
        kind: 'HandlerDeclaration',
        body: [{ kind: 'CollectionMutationStatement', operation: 'update', limit: { value: 1 } }],
      },
      { kind: 'Element' },
    ]);
  });

  it('recovers from an unindented multiline collection call', () => {
    const { result } = parseOnlyComponent(`App():
  users = [{ id: 1 }]
  remove():
    users.remove(
    user => user.id == 1
    )
  <p>{users.length}
`);

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OXE1102',
        message: 'Expected indented collection operation arguments.',
      }),
    );
  });

  it('always advances past leaked dedents while recovering at module scope', () => {
    const result = parseSource(`App():
  users = [{ id: 1 }]
  ordered = users.sort(
    user => user.id
  )
  <p>{users.length}

Other():
  <p>Recovered
`);

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.ast.declarations.map((declaration) => declaration.name.name)).toContain('Other');
  });

  it('parses direct nested record-field writes in procedures', () => {
    const { component, result } = parseOnlyComponent(`App():
  profile = { name: "Ada", address: { city: "London" } }
  move():
    profile.name = "Grace"
    profile.address.city = "New York"
  <p>{profile.address.city}
`);

    expect(result.diagnostics).toEqual([]);
    expect(component.body[1]).toMatchObject({
      kind: 'HandlerDeclaration',
      body: [
        { kind: 'MemberAssignmentStatement', target: { property: { name: 'name' } } },
        {
          kind: 'MemberAssignmentStatement',
          target: {
            property: { name: 'city' },
            object: { kind: 'MemberExpression', property: { name: 'address' } },
          },
        },
      ],
    });
  });

  it('parses multiline conditional result blocks for values and UI', () => {
    const { component, result } = parseOnlyComponent(`App():
  user = true
  label =?
    user ?
      prefix = "Hello"
      prefix + " Chris"
    : "Guest"
  ?
    user ?
      message = label
      <p>{message}
    : <p>Guest
`);

    expect(result.diagnostics).toEqual([]);
    expect(component.body).toMatchObject([
      { kind: 'AssignmentStatement' },
      {
        kind: 'AssignmentStatement',
        value: {
          kind: 'ConditionalValueExpression',
          branches: [
            {
              result: {
                kind: 'ConditionalResultBlock',
                statements: [{ target: { name: 'prefix' } }],
                result: { kind: 'BinaryExpression' },
              },
            },
            { result: { kind: 'StringLiteral' } },
          ],
        },
      },
      {
        kind: 'ConditionalRegion',
        branches: [
          {
            result: {
              kind: 'ConditionalResultBlock',
              statements: [{ target: { name: 'message' } }],
              result: { kind: 'Element' },
            },
          },
          { result: { kind: 'Element' } },
        ],
      },
    ]);
  });

  it('parses the locked untrack snapshot boundary as an ordinary expression', () => {
    const { component, result } = parseOnlyComponent(`App():
  count = 0
  snapshot = untrack(count)
  <p>{snapshot}
`);
    expect(result.diagnostics).toEqual([]);
    expect(component.body[1]).toMatchObject({
      kind: 'AssignmentStatement',
      value: {
        kind: 'UntrackExpression',
        expression: { kind: 'Identifier', name: 'count' },
      },
    });
  });

  it('parses the counter slice into an immutable JSON-serializable AST', () => {
    const source = `App():
  count = 0
  doubled = count * 2
  label = "Count"
  enabled = true

  increment():
    count = count + 1

  <main>
    <button onClick={increment}>{label}: {count}
    <p>Doubled: {doubled}
`;

    const { component, result } = parseOnlyComponent(source, 'counter.oxe');

    expect(result.diagnostics).toEqual([]);
    expect(component.name.name).toBe('App');
    expect(component.parameters).toEqual([]);
    expect(component.body.map((statement) => statement.kind)).toEqual([
      'AssignmentStatement',
      'AssignmentStatement',
      'AssignmentStatement',
      'AssignmentStatement',
      'HandlerDeclaration',
      'Element',
    ]);

    const doubled = component.body[1];
    expect(doubled).toMatchObject({
      kind: 'AssignmentStatement',
      target: { kind: 'Identifier', name: 'doubled' },
      value: {
        kind: 'BinaryExpression',
        operator: '*',
        left: { kind: 'Identifier', name: 'count' },
        right: { kind: 'NumberLiteral', value: 2 },
      },
    });
    expect(component.body[2]).toMatchObject({
      kind: 'AssignmentStatement',
      value: { kind: 'StringLiteral', value: 'Count' },
    });
    expect(component.body[3]).toMatchObject({
      kind: 'AssignmentStatement',
      value: { kind: 'BooleanLiteral', value: true },
    });

    const handler = component.body[4];
    expect(handler).toMatchObject({
      kind: 'HandlerDeclaration',
      name: { name: 'increment' },
      body: [
        {
          kind: 'AssignmentStatement',
          target: { name: 'count' },
          value: { kind: 'BinaryExpression', operator: '+' },
        },
      ],
    });

    const main = component.body[5];
    if (!main || main.kind !== 'Element') {
      throw new Error('Expected the final component statement to be the main element.');
    }
    expect(main.name.name).toBe('main');
    expect(main.children.map((child) => child.kind)).toEqual(['Element', 'Element']);

    const button = main.children[0];
    if (!button || button.kind !== 'Element') {
      throw new Error('Expected the first main child to be a button.');
    }
    expect(button.attributes).toMatchObject([
      {
        kind: 'Attribute',
        name: { name: 'onClick' },
        value: { kind: 'Identifier', name: 'increment' },
      },
    ]);
    expect(button.children).toMatchObject([
      { kind: 'Interpolation', expression: { name: 'label' } },
      { kind: 'Text', value: ': ' },
      { kind: 'Interpolation', expression: { name: 'count' } },
    ]);

    expect(JSON.parse(JSON.stringify(result.ast))).toEqual(result.ast);
    expect(Object.isFrozen(result.ast)).toBe(true);
    expect(Object.isFrozen(result.ast.declarations)).toBe(true);
    expect(Object.isFrozen(component)).toBe(true);
    expect(Object.isFrozen(component.parameters)).toBe(true);
    expect(Object.isFrozen(main.children)).toBe(true);
    expect(Object.isFrozen(button.attributes[0]?.span.start)).toBe(true);
  });

  it('parses strict component parameters and uppercase component elements', () => {
    const result = parseSource(`App():
  count = 0
  increment():
    count = count + 1
  <Counter count={count} onIncrement={increment}>
Counter(count, onIncrement):
  doubled = count * 2
  <section>
    <button onClick={onIncrement}>Count: {count}
    <p>Doubled: {doubled}
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.ast.declarations.map((declaration) => declaration.name.name)).toEqual([
      'App',
      'Counter',
    ]);

    const app = result.ast.declarations[0];
    const counter = result.ast.declarations[1];
    expect(app?.parameters).toEqual([]);
    expect(counter?.parameters).toMatchObject([
      { kind: 'RequiredComponentParameter', name: { name: 'count' } },
      { kind: 'RequiredComponentParameter', name: { name: 'onIncrement' } },
    ]);
    expect(counter?.parameters.map((parameter) => parameter.name.name)).toEqual([
      'count',
      'onIncrement',
    ]);
    expect(Object.isFrozen(counter?.parameters)).toBe(true);

    expect(app?.body[2]).toMatchObject({
      kind: 'Element',
      name: { name: 'Counter' },
      attributes: [
        { name: { name: 'count' }, value: { kind: 'Identifier', name: 'count' } },
        {
          name: { name: 'onIncrement' },
          value: { kind: 'Identifier', name: 'increment' },
        },
      ],
    });
    expect(counter?.body[1]).toMatchObject({
      kind: 'Element',
      name: { name: 'section' },
      children: [
        {
          kind: 'Element',
          name: { name: 'button' },
          attributes: [
            {
              name: { name: 'onClick' },
              value: { kind: 'Identifier', name: 'onIncrement' },
            },
          ],
        },
        { kind: 'Element', name: { name: 'p' } },
      ],
    });
  });

  it('respects arithmetic precedence, left associativity, and parentheses', () => {
    const { component, result } = parseOnlyComponent(`App():
  left = 8 - 3 - 1
  grouped = (1 + 2) * 3
`);

    expect(result.diagnostics).toEqual([]);
    expect(component.body[0]).toMatchObject({
      kind: 'AssignmentStatement',
      value: {
        kind: 'BinaryExpression',
        operator: '-',
        left: {
          kind: 'BinaryExpression',
          operator: '-',
          left: { value: 8 },
          right: { value: 3 },
        },
        right: { value: 1 },
      },
    });
    expect(component.body[1]).toMatchObject({
      kind: 'AssignmentStatement',
      value: {
        kind: 'BinaryExpression',
        operator: '*',
        left: {
          kind: 'ParenthesizedExpression',
          expression: { kind: 'BinaryExpression', operator: '+' },
        },
        right: { value: 3 },
      },
    });
  });

  it('parses strict equality and logical operators with one precedence table', () => {
    const { component, result } = parseOnlyComponent(`App():
  active = true and false or 1 == 1
  <p>{active}
`);
    expect(result.diagnostics).toEqual([]);
    expect(component.body[0]).toMatchObject({
      kind: 'AssignmentStatement',
      value: {
        kind: 'BinaryExpression',
        operator: 'or',
        left: { kind: 'BinaryExpression', operator: 'and' },
        right: { kind: 'BinaryExpression', operator: '==' },
      },
    });
  });

  it('assigns exact spans to declarations, expressions, attributes, text, and interpolations', () => {
    const source = `App():
  count = 1 + 2 * 3
  increment():
    count = count + 1
  <button onClick={increment}>Count: {count}
`;
    const { component, result } = parseOnlyComponent(source, 'spans.oxe');

    expect(result.diagnostics).toEqual([]);
    expect(result.ast.span).toEqual(sourceSpan('spans.oxe', [0, 1, 1], [109, 6, 1]));
    expect(component.span).toEqual(sourceSpan('spans.oxe', [0, 1, 1], [108, 5, 45]));

    const firstAssignment = component.body[0];
    expect(firstAssignment?.span).toEqual(sourceSpan('spans.oxe', [9, 2, 3], [26, 2, 20]));
    expect(firstAssignment).toMatchObject({
      kind: 'AssignmentStatement',
      value: {
        kind: 'BinaryExpression',
        operator: '+',
        span: sourceSpan('spans.oxe', [17, 2, 11], [26, 2, 20]),
        right: {
          kind: 'BinaryExpression',
          operator: '*',
          span: sourceSpan('spans.oxe', [21, 2, 15], [26, 2, 20]),
        },
      },
    });

    const handler = component.body[1];
    expect(handler?.span).toEqual(sourceSpan('spans.oxe', [29, 3, 3], [63, 4, 22]));

    const button = component.body[2];
    if (!button || button.kind !== 'Element') {
      throw new Error('Expected a button element.');
    }
    expect(button.span).toEqual(sourceSpan('spans.oxe', [66, 5, 3], [108, 5, 45]));
    expect(button.name.span).toEqual(sourceSpan('spans.oxe', [67, 5, 4], [73, 5, 10]));
    expect(button.attributes[0]?.span).toEqual(sourceSpan('spans.oxe', [74, 5, 11], [93, 5, 30]));
    expect(button.children).toMatchObject([
      {
        kind: 'Text',
        value: 'Count: ',
        span: sourceSpan('spans.oxe', [94, 5, 31], [101, 5, 38]),
      },
      {
        kind: 'Interpolation',
        span: sourceSpan('spans.oxe', [101, 5, 38], [108, 5, 45]),
        expression: {
          kind: 'Identifier',
          span: sourceSpan('spans.oxe', [102, 5, 39], [107, 5, 44]),
        },
      },
    ]);
  });

  it('parses a standalone interpolation as an indented markup child', () => {
    const { component, result } = parseOnlyComponent(`App():
  content = "Hello"
  <main>
    {content}
`);

    expect(result.diagnostics).toEqual([]);
    const main = component.body[1];
    expect(main).toMatchObject({
      kind: 'Element',
      children: [
        {
          kind: 'Interpolation',
          expression: { kind: 'Identifier', name: 'content' },
        },
      ],
    });
  });

  it('recovers at line boundaries after bad expressions and markup children', () => {
    const source = `App():
  broken =
  valid = 2
  <main>
    invalid child
    <p>Recovered: {valid}
`;
    const { component, result } = parseOnlyComponent(source, 'recovery.oxe');

    expect(result.diagnostics).toEqual([
      {
        code: 'OXE1105',
        message:
          'Expected an identifier, number, string, Boolean, array, record, or parenthesized expression.',
        severity: 'error',
        span: sourceSpan('recovery.oxe', [17, 2, 11], [17, 2, 11]),
      },
      {
        code: 'OXE1109',
        message: 'Expected an element, interpolation, or conditional in the indented markup block.',
        severity: 'error',
        span: sourceSpan('recovery.oxe', [43, 5, 5], [50, 5, 12]),
      },
    ]);
    expect(component.body.map((statement) => statement.kind)).toEqual([
      'AssignmentStatement',
      'Element',
    ]);
    const main = component.body[1];
    expect(main).toMatchObject({
      kind: 'Element',
      children: [
        {
          kind: 'Element',
          name: { name: 'p' },
          children: [
            { kind: 'Text', value: 'Recovered: ' },
            { kind: 'Interpolation', expression: { name: 'valid' } },
          ],
        },
      ],
    });
  });

  it('accepts uppercase elements for semantic resolution and diagnoses malformed attributes', () => {
    const { component, result } = parseOnlyComponent(
      `App():
  <Button>
  <button onClick=increment>Bad
  <p>After
`,
      'elements.oxe',
    );

    expect(result.diagnostics).toMatchObject([
      {
        code: 'OXE1107',
        message: 'Attribute values must use ={expression}.',
        span: sourceSpan('elements.oxe', [36, 3, 19], [45, 3, 28]),
      },
    ]);
    expect(component.body[0]).toMatchObject({
      kind: 'Element',
      name: { name: 'Button' },
    });
    expect(component.body.map((statement) => statement.kind)).toEqual([
      'Element',
      'Element',
      'Element',
    ]);
    expect(component.body[2]).toMatchObject({
      kind: 'Element',
      name: { name: 'p' },
      children: [{ kind: 'Text', value: 'After' }],
    });
  });

  it('recovers from an unclosed interpolation and parses the following element', () => {
    const { component, result } = parseOnlyComponent(
      `App():
  count = 1
  <p>Value: {count
  <p>After
`,
      'interpolation.oxe',
    );

    expect(result.diagnostics).toEqual([
      {
        code: 'OXE1108',
        message: 'Expected } to close the interpolation.',
        severity: 'error',
        span: sourceSpan('interpolation.oxe', [37, 3, 19], [37, 3, 19]),
      },
    ]);
    expect(component.body[1]).toMatchObject({
      kind: 'Element',
      children: [
        { kind: 'Text', value: 'Value: ' },
        { kind: 'Interpolation', expression: { name: 'count' } },
      ],
    });
    expect(component.body[2]).toMatchObject({
      kind: 'Element',
      name: { name: 'p' },
      children: [{ kind: 'Text', value: 'After' }],
    });
  });

  it('recovers from a missing body and continues with the next component', () => {
    const result = parseSource(`Empty():
Next():
  <p>Ready
`);

    expect(result.diagnostics).toMatchObject([
      {
        code: 'OXE1102',
        message: 'Expected an indented component body.',
        span: {
          start: { offset: 9, line: 2, column: 1 },
          end: { offset: 9, line: 2, column: 1 },
        },
      },
    ]);
    expect(result.ast.declarations.map((declaration) => declaration.name.name)).toEqual([
      'Empty',
      'Next',
    ]);
    expect(result.ast.declarations[1]?.body).toMatchObject([
      { kind: 'Element', children: [{ kind: 'Text', value: 'Ready' }] },
    ]);
  });

  it('diagnoses duplicate and malformed component parameter lists', () => {
    const duplicate = parseSource(`Counter(value, value):
  <p>{value}
`);
    expect(duplicate.diagnostics).toEqual([
      {
        code: 'OXE1101',
        message: 'Component parameter "value" is declared more than once.',
        severity: 'error',
        span: sourceSpan('<source>', [15, 1, 16], [20, 1, 21]),
      },
    ]);
    expect(
      duplicate.ast.declarations[0]?.parameters.map((parameter) => parameter.name.name),
    ).toEqual(['value', 'value']);

    const missingComma = parseSource(`Counter(first second):
  <p>{first}
`);
    expect(missingComma.diagnostics).toMatchObject([
      {
        code: 'OXE1101',
        message: 'Expected , or ) after the component parameter.',
        span: sourceSpan('<source>', [14, 1, 15], [20, 1, 21]),
      },
    ]);
    expect(
      missingComma.ast.declarations[0]?.parameters.map((parameter) => parameter.name.name),
    ).toEqual(['first']);

    const trailingComma = parseSource(`Counter(value,):
  <p>{value}
`);
    expect(trailingComma.diagnostics).toMatchObject([
      {
        code: 'OXE1101',
        message: 'Expected a component parameter after ,.',
        span: sourceSpan('<source>', [14, 1, 15], [15, 1, 16]),
      },
    ]);
    expect(
      trailingComma.ast.declarations[0]?.parameters.map((parameter) => parameter.name.name),
    ).toEqual(['value']);
  });

  it('parses defaults, a trailing rest parameter, spreads, and child content', () => {
    const result = parseSource(`App():
  props = "forwarded"
  <Card title={"Hello"} {...props} tone={"quiet"}>
    <p>Child content
Card(title, tone = "primary", ...props):
  <section {...props}>
    <h2>{title}
`);

    expect(result.diagnostics).toEqual([]);
    const app = result.ast.declarations[0];
    const card = result.ast.declarations[1];
    expect(card?.parameters).toMatchObject([
      { kind: 'RequiredComponentParameter', name: { name: 'title' } },
      {
        kind: 'DefaultComponentParameter',
        name: { name: 'tone' },
        defaultValue: { kind: 'StringLiteral', value: 'primary' },
      },
      { kind: 'RestComponentParameter', name: { name: 'props' } },
    ]);
    expect(Object.isFrozen(card?.parameters[1])).toBe(true);

    const invocation = app?.body[1];
    expect(invocation).toMatchObject({
      kind: 'Element',
      attributes: [
        { kind: 'Attribute', name: { name: 'title' } },
        { kind: 'SpreadAttribute', value: { kind: 'Identifier', name: 'props' } },
        { kind: 'Attribute', name: { name: 'tone' } },
      ],
      children: [{ kind: 'Element', name: { name: 'p' }, children: [{ value: 'Child content' }] }],
    });
  });

  it('parses named imports and direct declaration exports into immutable module syntax', () => {
    const result = parseSource(
      `import { Card, Button } from "./components.oxe"

export App():
  <Card>

Helper():
  <Button>
`,
      'App.oxe',
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.ast.imports).toMatchObject([
      {
        kind: 'ImportDeclaration',
        specifiers: [
          { kind: 'ImportSpecifier', name: { kind: 'Identifier', name: 'Card' } },
          { kind: 'ImportSpecifier', name: { kind: 'Identifier', name: 'Button' } },
        ],
        source: { kind: 'StringLiteral', value: './components.oxe' },
      },
    ]);
    expect(result.ast.declarations).toMatchObject([
      { kind: 'ComponentDeclaration', exported: true, name: { name: 'App' } },
      { kind: 'ComponentDeclaration', exported: false, name: { name: 'Helper' } },
    ]);
    expect(result.ast.span).toEqual(sourceSpan('App.oxe', [0, 1, 1], [94, 8, 1]));
    expect(result.ast.declarations[0]?.span.start).toEqual({ offset: 49, line: 3, column: 1 });
    expect(Object.isFrozen(result.ast.imports)).toBe(true);
    expect(Object.isFrozen(result.ast.imports[0])).toBe(true);
    expect(Object.isFrozen(result.ast.imports[0]?.specifiers)).toBe(true);
    expect(Object.isFrozen(result.ast.imports[0]?.source.span.start)).toBe(true);
  });

  it('requires imports to appear before all component declarations', () => {
    const result = parseSource(`App():
  <main>
import { Card } from "./Card.oxe"
`);

    expect(result.diagnostics).toMatchObject([
      {
        code: 'OXE1103',
        message: 'Imports must be declared before component declarations.',
        span: { start: { line: 3, column: 1 } },
      },
    ]);
    expect(result.ast.imports).toHaveLength(1);
    expect(result.ast.declarations).toHaveLength(1);
    expect(result.ast.span.start).toEqual({ offset: 0, line: 1, column: 1 });
  });

  it('rejects aliases and every alternate JavaScript import or export form', () => {
    const unsupported = [
      {
        source: 'import { Card as Panel } from "./Card.oxe"\n',
        message:
          'Import aliases are not supported. Import and use the exported component name directly.',
      },
      {
        source: 'import Card from "./Card.oxe"\n',
        message:
          'Imports must use explicit named imports: import { Component } from "./module.oxe"',
      },
      {
        source: 'import * as Components from "./Card.oxe"\n',
        message:
          'Imports must use explicit named imports: import { Component } from "./module.oxe"',
      },
      {
        source: 'import "./side-effect.oxe"\n',
        message:
          'Imports must use explicit named imports: import { Component } from "./module.oxe"',
      },
      {
        source: 'export { Card } from "./Card.oxe"\n',
        message: 'Exports must be written directly on a component declaration: export Component():',
      },
      {
        source: 'export default App\n',
        message: 'Exports must be written directly on a component declaration: export Component():',
      },
    ] as const;

    for (const entry of unsupported) {
      const result = parseSource(entry.source);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({ code: 'OXE1103', message: entry.message });
      expect(result.ast.imports).toEqual([]);
      expect(result.ast.declarations).toEqual([]);
    }
  });

  it('diagnoses invalid rest/default ordering and duplicate explicit attributes', () => {
    const result = parseSource(`Bad(optional = "yes", required, ...first, ...second):
  <Card title={required} title={optional}>
`);

    expect(result.diagnostics).toMatchObject([
      {
        code: 'OXE1101',
        message: 'Required component parameters must be declared before parameters with defaults.',
      },
      {
        code: 'OXE1101',
        message: 'The rest parameter must be the final component parameter.',
      },
      {
        code: 'OXE1101',
        message: 'A component can declare only one rest parameter.',
      },
      {
        code: 'OXE1107',
        message: 'Attribute "title" is written more than once.',
      },
    ]);
  });

  it('diagnoses malformed defaults and spread attributes with targeted messages', () => {
    const missingDefault = parseSource(`Button(tone =):
  <button>
`);
    expect(missingDefault.diagnostics).toMatchObject([
      {
        code: 'OXE1101',
        message: 'Expected a default value expression for parameter "tone".',
      },
    ]);

    const missingRestName = parseSource(`Card(...):
  <main>
`);
    expect(missingRestName.diagnostics).toMatchObject([
      {
        code: 'OXE1101',
        message: 'Expected a component rest parameter name after "...".',
      },
    ]);

    const malformedSpreads = parseSource(`App():
  <Card {props} {...}>
`);
    expect(malformedSpreads.diagnostics).toMatchObject([
      {
        code: 'OXE1107',
        message: 'Spread attributes must use {...expression}.',
      },
      {
        code: 'OXE1107',
        message: 'Expected an expression after ... in the spread attribute.',
      },
    ]);
  });

  it('parses handler parameters for ordinary procedural calls', () => {
    const { component, result } = parseOnlyComponent(`App():
  click(event):
    value = 1
  <button>
`);

    expect(result.diagnostics).toEqual([]);
    expect(component.body).toMatchObject([
      {
        kind: 'HandlerDeclaration',
        name: { name: 'click' },
        parameters: [{ name: 'event' }],
        body: [{ kind: 'AssignmentStatement', target: { name: 'value' } }],
      },
      { kind: 'Element', name: { name: 'button' } },
    ]);
  });
});
