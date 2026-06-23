import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  date,
  index,
  uniqueIndex,
  numeric,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  appleSub: text('apple_sub').notNull().unique(),
  displayName: text('display_name').notNull().default('Player'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userProgress = pgTable('user_progress', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  xp: integer('xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  streak: integer('streak').notNull().default(0),
  lastPlayedDate: date('last_played_date'),
  todayXp: integer('today_xp').notNull().default(0),
  todayXpDate: date('today_xp_date'),
});

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    externalId: text('external_id'),
    name: text('name').notNull(),
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
    nationality: text('nationality').notNull(),
    position: text('position').notNull(),
    age: integer('age').notNull(),
    currentClub: text('current_club').notNull(),
    currentLeague: text('current_league').notNull(),
    shirtNumber: integer('shirt_number'),
    marketValueTier: integer('market_value_tier').notNull().default(3),
    searchText: text('search_text').notNull(),
  },
  (table) => [
    index('players_search_idx').on(table.searchText),
    uniqueIndex('players_external_id_unique').on(table.externalId),
  ]
);

export const playerStats = pgTable(
  'player_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    externalPlayerId: text('external_player_id'),
    leagueId: integer('league_id').notNull(),
    leagueName: text('league_name').notNull(),
    season: integer('season').notNull(),
    teamId: integer('team_id').notNull().default(0),
    teamName: text('team_name'),
    appearances: integer('appearances').notNull().default(0),
    minutes: integer('minutes').notNull().default(0),
    goals: integer('goals').notNull().default(0),
    assists: integer('assists').notNull().default(0),
    yellowCards: integer('yellow_cards').notNull().default(0),
    redCards: integer('red_cards').notNull().default(0),
    cleanSheets: integer('clean_sheets'),
    saves: integer('saves'),
    foulsCommitted: integer('fouls_committed'),
    tackles: integer('tackles'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('player_stats_unique').on(
      table.playerId,
      table.leagueId,
      table.season,
      table.teamId
    ),
    index('player_stats_league_metric_idx').on(table.leagueId, table.season),
  ]
);

export const playerTransfers = pgTable(
  'player_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    transferDate: date('transfer_date'),
    fromTeamId: integer('from_team_id').notNull().default(0),
    fromTeamName: text('from_team_name'),
    toTeamId: integer('to_team_id').notNull().default(0),
    toTeamName: text('to_team_name'),
    feeRaw: text('fee_raw'),
    feeEurM: numeric('fee_eur_m', { precision: 10, scale: 2 }),
    transferType: text('transfer_type').notNull().default('unknown'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('player_transfers_unique').on(
      table.playerId,
      table.transferDate,
      table.fromTeamId,
      table.toTeamId
    ),
  ]
);

export const playerHonours = pgTable(
  'player_honours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    competition: text('competition').notNull(),
    country: text('country'),
    season: text('season').notNull(),
    placement: text('placement').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('player_honours_unique').on(
      table.playerId,
      table.competition,
      table.season,
      table.placement
    ),
  ]
);

export const playerCareer = pgTable(
  'player_career',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    teamId: integer('team_id').notNull(),
    teamName: text('team_name').notNull(),
    seasonFrom: integer('season_from').notNull(),
    seasonTo: integer('season_to'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('player_career_unique').on(table.playerId, table.teamId, table.seasonFrom),
  ]
);

/** API-Football team ids → crest URLs (media CDN, free quota). */
export const teams = pgTable(
  'teams',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    nameNorm: text('name_norm').notNull(),
    leagueId: integer('league_id'),
    country: text('country'),
    logoUrl: text('logo_url').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('teams_name_norm_idx').on(table.nameNorm),
    index('teams_league_id_idx').on(table.leagueId),
  ]
);

export const ingestRuns = pgTable('ingest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobName: text('job_name').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('running'),
  rowsUpserted: integer('rows_upserted').notNull().default(0),
  apiCallsUsed: integer('api_calls_used').notNull().default(0),
  errorMessage: text('error_message'),
});

export const dailyPuzzles = pgTable(
  'daily_puzzles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date').notNull(),
    modeId: text('mode_id').notNull(),
    puzzleJson: jsonb('puzzle_json').notNull(),
    answerPlayerId: uuid('answer_player_id').references(() => players.id),
    answerJson: jsonb('answer_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('daily_puzzles_date_mode_idx').on(table.date, table.modeId),
    uniqueIndex('daily_puzzles_date_mode_unique').on(table.date, table.modeId),
  ]
);

export const dailyCompletions = pgTable(
  'daily_completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    modeId: text('mode_id').notNull(),
    score: integer('score').notNull(),
    guesses: integer('guesses').notNull(),
    won: boolean('won').notNull(),
    shareGrid: text('share_grid').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('daily_completions_user_date_idx').on(table.userId, table.date)]
);

export type User = typeof users.$inferSelect;
export type Player = typeof players.$inferSelect;
export type PlayerStat = typeof playerStats.$inferSelect;
export type PlayerTransfer = typeof playerTransfers.$inferSelect;
export type PlayerHonour = typeof playerHonours.$inferSelect;
export type PlayerCareerEntry = typeof playerCareer.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type DailyPuzzle = typeof dailyPuzzles.$inferSelect;
