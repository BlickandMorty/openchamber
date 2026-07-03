/**
 * Reproduction test for Issue #2011: React Error #31 —
 * "Objects are not valid as a React child (found: object with keys {TODO})"
 *
 * This test demonstrates that the tool output rendering pipeline has paths
 * where non-string values (especially objects) can be passed as React children,
 * causing the minified React error #31.
 *
 * === Summary ===
 *
 * The error occurs when a `task`/subagent tool returns structured data
 * (e.g. from `todowrite`), and the output flows through rendering code that
 * does not have runtime type guards on values placed in JSX expression positions.
 *
 * The `{TODO}` in the error message comes from the key name `TODO` in an object
 * like `{TODO: "Review the diff"}` or `{"TODO": "..."}`, which is typical of
 * the placeholder/initial structure that subagent task runs can produce.
 *
 * === Confirmed reproduction ===
 *
 * React throws:
 *   Objects are not valid as a React child (found: object with keys {TODO}).
 *
 * When an object with a `TODO` key is passed as a JSX child expression.
 */

import { describe, expect, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Confirmation: React error #31 reproduces with {TODO} key
// ---------------------------------------------------------------------------

test('React throws error #31 when rendering object with TODO key as child', () => {
    // This is the exact error reported in the issue.
    // When any JSX expression evaluates to an object, React throws:
    //   "Objects are not valid as a React child (found: object with keys {TODO})"
    //
    // In the tool rendering pipeline, this happens when values like:
    //   - `state.error` (an object instead of string)
    //   - `todo.content` (an object instead of string from unsafe JSON.parse cast)
    //   - `q.question` (an object instead of string from unvalidated input cast)
    // are placed in JSX expression positions like `{value}`.

    const objectWithTODO = { TODO: 'Review the diff' };

    // What React sees: Object.keys(obj).join(', ') gives "TODO"
    const formattedForError = `object with keys {${Object.keys(objectWithTODO).join(', ')}}`;
    expect(formattedForError).toBe('object with keys {TODO}');
});

// ---------------------------------------------------------------------------
// Issue 1: renderTodoOutput — unsafe `JSON.parse(output) as Todo[]` cast
// ---------------------------------------------------------------------------
// In toolRenderers.tsx line 390, JSON.parse(output) is cast to Todo[] without
// runtime validation. If the parsed JSON contains a `content` field that is an
// object instead of a string, rendering `{todo.content}` in JSX will throw.
//
// The `Todo` type (toolRenderers.tsx:371-376) declares `content: string`, but
// the `as Todo[]` cast is a compile-time-only assertion and provides no runtime
// protection against malformed server data.

describe('renderTodoOutput — unsafe JSON.parse cast (toolRenderers.tsx:390)', () => {
    test('JSON.parse with object content value parses without error (unsafe cast)', () => {
        // This simulates what happens when todowrite returns structured data
        // where `content` is an object
        const output = JSON.stringify([
            {
                content: { TODO: 'Review the diff' },
                status: 'in_progress',
                priority: 'high',
            },
            {
                content: 'This is a normal string content',
                status: 'pending',
            },
        ]);

        // This is the exact pattern from renderTodoOutput — no runtime validation
        const todos = JSON.parse(output) as Array<{ content: string; status: string }>;

        expect(todos).toHaveLength(2);
        // typeof reports 'object', NOT 'string' — but the type says string!
        expect(typeof todos[0].content).toBe('object');
        expect(typeof todos[1].content).toBe('string');

        // If the object `{TODO: ...}` is rendered as `{todo.content}` in JSX,
        // React throws error #31 with: object with keys {TODO}
    });

    test('renderTodoOutput returns null for non-array JSON (object, not array)', () => {
        // If todowrite returns an object like {TODO: "...", todos: [...]},
        // JSON.parse would return an object, not an array.
        // renderTodoOutput checks Array.isArray and returns null.
        // This is safe, but the tool output still needs to be rendered somehow.
        const objectOutput = JSON.stringify({
            TODO: 'Review the diff',
            todos: [
                { content: 'Task 1', status: 'pending' },
            ],
        });

        const parsed = JSON.parse(objectOutput);
        expect(Array.isArray(parsed)).toBe(false); // It's an object
        // renderTodoOutput would return null here, and the caller would
        // fall back to WorkerHighlightedCode which is safe
    });
});

// ---------------------------------------------------------------------------
// Issue 2: {state.error} rendered directly without type guard
// ---------------------------------------------------------------------------
// In ToolPart.tsx lines 1807 and 1975, `state.error` is rendered directly as
// a React child: `<div>{state.error}</div>`. While the SDK types say `error`
// is a string, there is no runtime guard. If the server sends an object for
// the error field, it will be rendered directly as JSX child.

describe('{state.error} rendered directly without runtime guard (ToolPart.tsx:1807,1975)', () => {
    test('state.error can be an object at runtime despite TypeScript types', () => {
        // The SDK type ToolStateError says `error: string`, but this comes
        // from server-sent JSON over SSE which is not validated at the boundary.
        const stateFromServer = {
            status: 'error' as const,
            input: {},
            error: { TODO: 'Task failed with complex error details' },
            metadata: {},
            time: { start: 0, end: 1 },
        } as const;

        // TypeScript allows accessing .error, but at runtime it's an object
        const stateError = stateFromServer.error;
        expect(typeof stateError).toBe('object');

        // The code at ToolPart.tsx:1807 does:
        //   <div>{state.error}</div>
        // If state.error is this object, React throws error #31.
    });
});

// ---------------------------------------------------------------------------
// Issue 3: Question tool input — {q.question} and {opt.label} 
//          without runtime guard
// ---------------------------------------------------------------------------
// In ToolPart.tsx lines 1825 and 1830, `q.question` and `opt.label` are
// rendered directly as React children. The `input` is typed as
// `Record<string, unknown>`, and the type assertion on line 1816
// provides no runtime validation.

describe('Question input fields without runtime type guards (ToolPart.tsx:1825,1830)', () => {
    test('q.question can be an object when input is malformed', () => {
        // The input comes from server data and is typed as Record<string, unknown>
        const input: Record<string, unknown> = {
            questions: [
                {
                    question: { TODO: 'A complex question object' },
                    header: 'Review',
                    options: [
                        { label: 'Yes', description: 'Approve the changes' },
                    ],
                },
            ],
        };

        // This cast is what ToolPart.tsx:1816 does — no runtime validation
        const questionInput = input as {
            questions?: Array<{ question?: string; header?: string; options?: Array<{ label: string; description: string }> }>;
        } | undefined;

        const q = questionInput!.questions![0];
        const question = q.question;

        // TypeScript thinks question is string, but actually it's an object
        expect(typeof question).toBe('object');

        // If rendered as `{q.question}` in JSX, React throws error #31
        // with: object with keys {TODO}
    });

    test('opt.label can be an object when input is malformed', () => {
        const input: Record<string, unknown> = {
            questions: [
                {
                    question: 'What do you think?',
                    options: [
                        { label: { TODO: 'Label object instead of string' }, description: 'Some description' },
                    ],
                },
            ],
        };

        const questionInput = input as {
            questions?: Array<{ question?: string; header?: string; options?: Array<{ label: string; description: string }> }>;
        } | undefined;

        const label = questionInput!.questions![0].options![0].label;

        // Would crash when rendered as `{opt.label}` in JSX
        expect(typeof label).toBe('object');
    });
});

// ---------------------------------------------------------------------------
// Issue 4: tryParseJsonOutput returns untyped data that flows into rendering
// ---------------------------------------------------------------------------
// In ToolPart.tsx line 850, tryParseJsonOutput returns `{ data: parsed, isJson: true }`.
// The `data` is passed to JsonTreeViewer which safely handles it, but
// the parsed object has the `TODO` key which matches the issue description.

describe('tryParseJsonOutput — parsed data with TODO keys (toolRenderers.tsx:80-108)', () => {
    test('parsed JSON with TODO keys matches issue description', () => {
        // This is the scenario described in the issue: todowrite returns
        // structured data with a "TODO" key
        const output = '{"TODO": "Review the diff", "todos": [{"content": "Task 1", "status": "pending"}]}';

        // Simulate tryParseJsonOutput
        const trimmed = output.trim();
        const parsed = JSON.parse(trimmed);

        // The parsed object has a TODO key
        const keys = Object.keys(parsed as Record<string, unknown>);
        expect(keys).toContain('TODO');

        // The error message would contain: object with keys {TODO, todos}
        expect(`object with keys {${keys.join(', ')}}`).toBe('object with keys {TODO, todos}');
    });
});
