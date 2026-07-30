import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildPlayerSearchFields, formatDisplayName } from './playerSearch.js';

test('a bare name keeps its surname particles and middle tokens', () => {
  // FBref supplies one already-fan-facing string and no firstname/lastname split. Truncating to
  // "first + last token" ate the surname: Le Tissier became "Matt Tissier", van Basten "Marco Basten".
  for (const name of [
    'Matt Le Tissier',
    'Marco van Basten',
    'Paolo Di Canio',
    'Jimmy Floyd Hasselbaink',
    'Ruud van Nistelrooy',
    'José Mari Bakero',
  ]) {
    assert.equal(formatDisplayName(name), name);
    assert.equal(buildPlayerSearchFields(name).name, name);
  }
});

test('a bare two-part name is unchanged', () => {
  assert.equal(formatDisplayName('Alan Shearer'), 'Alan Shearer');
  assert.equal(buildPlayerSearchFields('Alan Shearer').name, 'Alan Shearer');
});

test('an API profile still shortens a legal name to the fan-facing one', () => {
  assert.equal(formatDisplayName('R. Sterling', 'Raheem Shaquille', 'Sterling'), 'Raheem Sterling');
  assert.equal(formatDisplayName('Raheem Sterling', 'Raheem Shaquille', 'Sterling'), 'Raheem Sterling');
  assert.equal(formatDisplayName('Joshua Kimmich', 'Joshua Walter', 'Kimmich'), 'Joshua Kimmich');
});

test('a bare abbreviated name is still expanded where possible', () => {
  // The early return must not swallow squad-list initials, which have no fan-facing form to keep.
  assert.equal(formatDisplayName('H. Kane', '', '', ['Harry Kane']), 'H. Kane');
  assert.equal(formatDisplayName('H. Kane', 'Harry', 'Kane'), 'Harry Kane');
});

test('search text and aliases still carry the full name for lookup', () => {
  const fields = buildPlayerSearchFields('Matt Le Tissier');
  assert.equal(fields.name, 'Matt Le Tissier');
  assert.ok(fields.searchText.includes('matt le tissier'));
  assert.ok(fields.aliases.includes('Tissier'));
});
