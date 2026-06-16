import { and, eq, ilike, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import type { GuessFeedbackField, PlayerSearchResult } from '../types.js';

export type FeedbackStatus = 'correct' | 'partial' | 'wrong';

export function compareField(
  guess: string | number | null,
  answer: string | number | null,
  field: string
): FeedbackStatus {
  if (guess === answer) return 'correct';

  if (field === 'age' && typeof guess === 'number' && typeof answer === 'number') {
    const diff = Math.abs(guess - answer);
    if (diff <= 2) return 'partial';
  }

  if (field === 'shirtNumber' && typeof guess === 'number' && typeof answer === 'number') {
    const diff = Math.abs(guess - answer);
    if (diff <= 3) return 'partial';
  }

  if (field === 'marketValueTier' && typeof guess === 'number' && typeof answer === 'number') {
    const diff = Math.abs(guess - answer);
    if (diff === 1) return 'partial';
  }

  return 'wrong';
}

export function buildGuessFeedback(
  guessPlayer: typeof players.$inferSelect,
  answerPlayer: typeof players.$inferSelect
): GuessFeedbackField[] {
  const fields: Array<{ field: string; guess: string | number | null; answer: string | number | null }> = [
    { field: 'nationality', guess: guessPlayer.nationality, answer: answerPlayer.nationality },
    { field: 'league', guess: guessPlayer.currentLeague, answer: answerPlayer.currentLeague },
    { field: 'club', guess: guessPlayer.currentClub, answer: answerPlayer.currentClub },
    { field: 'position', guess: guessPlayer.position, answer: answerPlayer.position },
    { field: 'age', guess: guessPlayer.age, answer: answerPlayer.age },
    {
      field: 'shirtNumber',
      guess: guessPlayer.shirtNumber,
      answer: answerPlayer.shirtNumber,
    },
    {
      field: 'marketValueTier',
      guess: guessPlayer.marketValueTier,
      answer: answerPlayer.marketValueTier,
    },
  ];

  return fields.map(({ field, guess, answer }) => ({
    field,
    value: guess,
    status: compareField(guess, answer, field),
  }));
}

export function isCorrectGuess(
  guessPlayer: typeof players.$inferSelect,
  answerPlayer: typeof players.$inferSelect
): boolean {
  return guessPlayer.id === answerPlayer.id;
}

export async function searchPlayers(query: string, limit = 10): Promise<PlayerSearchResult[]> {
  const normalized = query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (normalized.length < 2) return [];

  const rows = await db
    .select()
    .from(players)
    .where(
      or(
        ilike(players.searchText, `%${normalized}%`),
        ilike(players.name, `%${query}%`)
      )
    )
    .limit(limit);

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    club: p.currentClub,
    league: p.currentLeague,
    nationality: p.nationality,
    position: p.position,
  }));
}

export async function getPlayerById(id: string) {
  const rows = await db.select().from(players).where(eq(players.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getAllPlayers() {
  return db.select().from(players);
}

export async function getPlayerByName(name: string) {
  const rows = await db
    .select()
    .from(players)
    .where(ilike(players.name, name))
    .limit(1);
  return rows[0] ?? null;
}

export function playerToSnapshot(player: typeof players.$inferSelect) {
  return {
    id: player.id,
    name: player.name,
    nationality: player.nationality,
    league: player.currentLeague,
    club: player.currentClub,
    position: player.position,
    age: player.age,
    shirtNumber: player.shirtNumber,
    marketValueTier: player.marketValueTier,
  };
}

export async function findPlayerForGuess(identifier: string) {
  const byId = await getPlayerById(identifier);
  if (byId) return byId;

  const normalized = identifier
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const all = await getAllPlayers();
  return (
    all.find((p) => p.searchText === normalized) ??
    all.find((p) => p.name.toLowerCase() === identifier.toLowerCase()) ??
    all.find((p) => p.aliases.some((a) => a.toLowerCase() === identifier.toLowerCase())) ??
    null
  );
}
