import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compatibleSubPositions,
  SLOT_POSITION_COMPATIBILITY,
  VALID_SUB_POSITIONS,
} from './playerPositionService.js';

test('Draft XI slot compatibility matches the approved matrix', () => {
  assert.deepEqual(SLOT_POSITION_COMPATIBILITY, {
    Goalkeeper: ['Goalkeeper'],
    'Centre-Back': ['Centre-Back'],
    'Left-Back': ['Left-Back'],
    'Right-Back': ['Right-Back'],
    'Defensive Midfield': ['Defensive Midfield', 'Central Midfield'],
    'Central Midfield': ['Central Midfield', 'Defensive Midfield', 'Attacking Midfield'],
    'Attacking Midfield': ['Attacking Midfield', 'Central Midfield', 'Second Striker'],
    'Left Midfield': ['Left Midfield', 'Left Winger'],
    'Right Midfield': ['Right Midfield', 'Right Winger'],
    'Left Winger': ['Left Winger', 'Left Midfield'],
    'Right Winger': ['Right Winger', 'Right Midfield'],
    'Centre-Forward': ['Centre-Forward', 'Second Striker'],
    'Second Striker': ['Second Striker', 'Centre-Forward', 'Attacking Midfield'],
  });
});

test('every canonical position accepts itself', () => {
  for (const position of VALID_SUB_POSITIONS) {
    assert.ok(compatibleSubPositions(position).includes(position), `${position} must accept itself`);
  }
});

test('fullbacks and wingers do not cross via midfield bridges', () => {
  assert.deepEqual(compatibleSubPositions('Left Midfield'), ['Left Midfield', 'Left Winger']);
  assert.deepEqual(compatibleSubPositions('Right Midfield'), ['Right Midfield', 'Right Winger']);
  assert.ok(!compatibleSubPositions('Left-Back').includes('Left Winger'));
  assert.ok(!compatibleSubPositions('Left-Back').includes('Left Midfield'));
  assert.ok(!compatibleSubPositions('Left Winger').includes('Left-Back'));
  assert.ok(!compatibleSubPositions('Right-Back').includes('Right Winger'));
  assert.ok(!compatibleSubPositions('Right-Back').includes('Right Midfield'));
  assert.ok(!compatibleSubPositions('Right Winger').includes('Right-Back'));
  assert.ok(!compatibleSubPositions('Right Midfield').includes('Right-Back'));
  assert.ok(!compatibleSubPositions('Left Midfield').includes('Left-Back'));
  assert.ok(!compatibleSubPositions('Centre-Back').includes('Defensive Midfield'));
  assert.ok(!compatibleSubPositions('Left Winger').includes('Right Winger'));
});

test('unknown legacy positions remain exact-match only', () => {
  assert.deepEqual(compatibleSubPositions('Sweeper'), ['Sweeper']);
});
