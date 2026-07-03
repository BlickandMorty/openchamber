#!/usr/bin/env bun
/**
 * Reproduction script for Issue #2011
 *
 * This script demonstrates that React throws error #31:
 *   "Objects are not valid as a React child (found: object with keys {TODO})"
 *
 * When an object value is passed directly as a JSX child expression.
 * This is what happens in the tool output rendering pipeline when
 * values like `state.error`, `todo.content`, `q.question`, or `opt.label`
 * are objects at runtime (instead of strings) but are placed in
 * JSX expression positions like `{value}`.
 *
 * Usage: bun run packages/ui/src/components/chat/message/parts/__tests__/reproduce-react-error-2011.js
 */

const React = require('react');
const ReactDOM = require('react-dom/server');

console.log('=== Reproduction of Issue #2011 ===');
console.log('');

// Test 1: Object with {TODO} key as React child
console.log('Test 1: Rendering {TODO: ...} as React child...');
try {
    const element = React.createElement('div', null, { TODO: 'Review the diff' });
    ReactDOM.renderToString(element);
    console.log('  NO ERROR (unexpected)');
} catch (e) {
    console.log('  ERROR:', e.message);
    console.log('  -> This matches the issue report!');
}

// Test 2: Object with TODO key inside a nested structure
console.log('');
console.log('Test 2: Rendering object with nested TODO...');
try {
    // Simulates: <div>{todo.content}</div> where todo.content = {TODO: "..."}
    const element = React.createElement('div', null,
        React.createElement('span', null, 'Status: '),
        { TODO: 'Review the diff' }
    );
    ReactDOM.renderToString(element);
    console.log('  NO ERROR (unexpected)');
} catch (e) {
    console.log('  ERROR:', e.message);
}

// Test 3: Object passed as child via variable
console.log('');
console.log('Test 3: Object passed through a variable...');
try {
    const stateError = { TODO: 'Task failed with complex error details' };
    // Simulates: <div>{state.error}</div> where state.error is an object
    const element = React.createElement('div', { className: 'error' }, stateError);
    ReactDOM.renderToString(element);
    console.log('  NO ERROR (unexpected)');
} catch (e) {
    console.log('  ERROR:', e.message);
}

// Test 4: Multiple keys
console.log('');
console.log('Test 4: Object with multiple keys including TODO...');
try {
    const obj = { TODO: 'something', todos: [{ content: 'Task 1', status: 'pending' }] };
    const element = React.createElement('div', null, obj);
    ReactDOM.renderToString(element);
    console.log('  NO ERROR (unexpected)');
} catch (e) {
    console.log('  ERROR:', e.message);
    // Would show: object with keys {TODO, todos}
}

// Test 5: Null check (verifying that null does NOT throw)
console.log('');
console.log('Test 5: null as React child (should not throw)...');
try {
    const element = React.createElement('div', null, null);
    ReactDOM.renderToString(element);
    console.log('  OK - null is valid');
} catch (e) {
    console.log('  UNEXPECTED ERROR:', e.message);
}

// Test 6: String check (verifying that strings do NOT throw)
console.log('');
console.log('Test 6: string as React child (should not throw)...');
try {
    const element = React.createElement('div', null, 'A normal string');
    ReactDOM.renderToString(element);
    console.log('  OK - string is valid');
} catch (e) {
    console.log('  UNEXPECTED ERROR:', e.message);
}

console.log('');
console.log('=== Summary ===');
console.log('React throws error #31 when any object value is passed');
console.log('as a JSX child expression. In the tool output rendering');
console.log('pipeline, the following code paths are vulnerable:');
console.log('');
console.log('1. ToolPart.tsx:1807,1975 — {state.error} when error is an object');
console.log('2. toolRenderers.tsx:449,466,483,500 — {todo.content} after unsafe JSON.parse cast');
console.log('3. ToolPart.tsx:1825 — {q.question} without runtime guard');
console.log('4. ToolPart.tsx:1830 — {opt.label} without runtime guard');
console.log('');
console.log('All of these need runtime type checks before rendering.');
