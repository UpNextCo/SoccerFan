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
  customType,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  appleSub: text('apple_sub').notNull().unique(),
  displayName: text('display_name').notNull().default('Player'),
  favoriteTeamId: integer('favorite_team_id'),
  /** Compressed JPEG bytes for the user's profile photo (served via GET /avatars/:userId). */
  avatarJpeg: bytea('avatar_jpeg'),
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
    birthDate: date('birth_date'),
    currentClub: text('current_club').notNull(),
    currentLeague: text('current_league').notNull(),
    shirtNumber: integer('shirt_number'),
    foot: text('foot'), // 'left' | 'right' | 'both' — preferred foot, from Transfermarkt
    subPosition: text('sub_position'), // fine position from Transfermarkt (Right-Back, Centre-Back, Left Winger…)
    subPositions: text('sub_positions').array().notNull().default([]), // all in-game fine positions (primary + alternates)
    apiFootballId: integer('api_football_id'), // API-Football player id → headshot CDN (separate from external_id dedup key)
    photoUrl: text('photo_url'), // manual headshot override (e.g. Wikimedia Commons) — wins over the CDN photo
    marketValueTier: integer('market_value_tier').notNull().default(3),
    marketValueEur: integer('market_value_eur'),
    peakMarketValueEur: integer('peak_market_value_eur'),
    recordFeeEur: integer('record_fee_eur'),
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
    /** Ops review: generated | approved | locked — locked rows are never auto-overwritten. */
    status: text('status').notNull().default('generated'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    contentHash: text('content_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('daily_puzzles_date_mode_idx').on(table.date, table.modeId),
    uniqueIndex('daily_puzzles_date_mode_unique').on(table.date, table.modeId),
    index('daily_puzzles_status_idx').on(table.status),
  ]
);

export const opsGenerationRuns = pgTable(
  'ops_generation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    yearMonth: text('year_month').notNull(),
    requestedModes: text('requested_modes').array().notNull(),
    modeScope: text('mode_scope').notNull(),
    status: text('status').notNull().default('queued'),
    totalCount: integer('total_count').notNull(),
    completedCount: integer('completed_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    requestedBy: text('requested_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ops_generation_runs_active_month_unique')
      .on(table.yearMonth)
      .where(sql`${table.status} IN ('queued', 'running')`),
    index('ops_generation_runs_month_created_idx').on(table.yearMonth, table.createdAt),
    index('ops_generation_runs_status_updated_idx').on(table.status, table.updatedAt),
    check('ops_generation_runs_year_month_check', sql`${table.yearMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'ops_generation_runs_status_check',
      sql`${table.status} IN ('queued', 'running', 'completed', 'completed_with_failures')`
    ),
    check('ops_generation_runs_total_count_check', sql`${table.totalCount} >= 0`),
    check('ops_generation_runs_completed_count_check', sql`${table.completedCount} >= 0`),
    check('ops_generation_runs_failed_count_check', sql`${table.failedCount} >= 0`),
    check('ops_generation_runs_skipped_count_check', sql`${table.skippedCount} >= 0`),
    check(
      'ops_generation_runs_counter_bounds_check',
      sql`${table.completedCount} <= ${table.totalCount}
        AND ${table.failedCount} <= ${table.completedCount}
        AND ${table.skippedCount} <= ${table.completedCount}
        AND ${table.failedCount} + ${table.skippedCount} <= ${table.completedCount}`
    ),
  ]
);

export const opsGenerationItems = pgTable(
  'ops_generation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => opsGenerationRuns.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    modeId: text('mode_id').notNull(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ops_generation_items_run_date_mode_unique').on(
      table.runId,
      table.date,
      table.modeId
    ),
    index('ops_generation_items_claim_idx').on(table.status, table.nextAttemptAt),
    index('ops_generation_items_run_status_idx').on(table.runId, table.status),
    check(
      'ops_generation_items_status_check',
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'skipped', 'failed')`
    ),
    check('ops_generation_items_attempts_check', sql`${table.attempts} >= 0 AND ${table.attempts} <= 3`),
  ]
);

export const opsMedia = pgTable(
  'ops_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    mimeType: text('mime_type').notNull(),
    bytes: bytea('bytes').notNull(),
    size: integer('size').notNull(),
    originalFilename: text('original_filename'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ops_media_kind_created_idx').on(table.kind, table.createdAt),
    check('ops_media_kind_check', sql`${table.kind} = 'lms_custom_image'`),
    check(
      'ops_media_mime_type_check',
      sql`${table.mimeType} IN ('image/jpeg', 'image/png', 'image/webp')`
    ),
    check('ops_media_size_check', sql`${table.size} > 0 AND ${table.size} <= 2621440`),
    check('ops_media_bytes_size_check', sql`octet_length(${table.bytes}) = ${table.size}`),
    check(
      'ops_media_original_filename_check',
      sql`${table.originalFilename} IS NULL OR length(${table.originalFilename}) <= 255`
    ),
  ]
);

/**
 * Reusable Ops-authored question definitions. `config` is structured, mode-specific JSON;
 * execution code must interpret known keys and must never treat it as SQL.
 */
export const questionTemplates = pgTable(
  'question_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mode: text('mode').notNull(),
    name: text('name').notNull(),
    prompt: text('prompt').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull().default('draft'), // draft | active | archived
    validationPassCount: integer('validation_pass_count').notNull().default(0),
    validationFailCount: integer('validation_fail_count').notNull().default(0),
    usedCount: integer('used_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('question_templates_mode_name_unique').on(table.mode, table.name),
    index('question_templates_mode_status_idx').on(table.mode, table.status),
    check('question_templates_status_check', sql`${table.status} IN ('draft', 'active', 'archived')`),
    check('question_templates_validation_pass_count_check', sql`${table.validationPassCount} >= 0`),
    check('question_templates_validation_fail_count_check', sql`${table.validationFailCount} >= 0`),
    check('question_templates_used_count_check', sql`${table.usedCount} >= 0`),
    check('question_templates_active_config_check', sql`
      ${table.status} <> 'active' OR (
        ${table.mode} = 'one_more'
        AND jsonb_typeof(${table.config}) = 'object'
        AND jsonb_typeof(${table.config}->'metricId') = 'string'
        AND ${table.config}->>'metricId' IN (
          'pl_goals', 'pl_assists', 'laliga_goals', 'seriea_goals', 'cl_goals',
          'cl_knockout_goals', 'pl_penalties', 'laliga_penalties', 'seriea_penalties',
          'hattricks', 'intl_caps', 'goals_before_21', 'weak_foot_goals',
          'non_big6_pl_goals', 'seriea_ligue1_goals'
        )
        AND jsonb_typeof(${table.config}->'threshold') = 'number'
        AND (${table.config}->>'threshold')::numeric >= 0
        AND jsonb_typeof(${table.config}->'valueNoun') = 'string'
        AND length(trim(${table.config}->>'valueNoun')) > 0
      )
    `),
  ]
);

/**
 * Reviewed bank of Football Tower prompts. Built offline in batches (Claude proposes →
 * DB verifies → Claude rates), manually QA'd via `status`, then the daily puzzle draws
 * from here WITHOUT replacement (least-recently-used) so days never repeat for a long time.
 */
export const towerPrompts = pgTable(
  'tower_prompts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prompt: text('prompt').notNull(),
    promptNorm: text('prompt_norm').notNull(),
    rule: jsonb('rule').notNull(),
    answerType: text('answer_type').notNull(),
    tier: text('tier').notNull(), // easy | medium | hard | elite
    difficulty: integer('difficulty').notNull(), // 0-100
    validAnswers: integer('valid_answers').notNull(),
    sampleAnswers: jsonb('sample_answers').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('active'), // active | rejected
    usedCount: integer('used_count').notNull().default(0),
    lastUsedDate: date('last_used_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tower_prompts_norm_unique').on(table.promptNorm),
    index('tower_prompts_tier_status_idx').on(table.tier, table.status),
  ]
);

/**
 * Curated Last Man Standing question bank. Built offline: DB builders fill facts →
 * Claude reviews the FINISHED card (keep/reject + difficulty) → daily composer draws
 * least-recently-used rows. Claude never invents football facts.
 */
export const lmsBank = pgTable(
  'lms_bank',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    tier: text('tier').notNull(), // easy | medium | hard | signature
    difficulty: integer('difficulty').notNull().default(50), // 0-100 from Claude review
    repeatKey: text('repeat_key').notNull(),
    repeatNorm: text('repeat_norm').notNull(),
    contentSignature: text('content_signature'),
    questionJson: jsonb('question_json').notNull(),
    answerJson: jsonb('answer_json').notNull(),
    extraKeys: jsonb('extra_keys').$type<string[]>().notNull().default([]),
    reviewReason: text('review_reason'),
    status: text('status').notNull().default('active'), // active | rejected
    usedCount: integer('used_count').notNull().default(0),
    lastUsedDate: date('last_used_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('lms_bank_repeat_norm_idx').on(table.repeatNorm),
    uniqueIndex('lms_bank_content_signature_unique')
      .on(table.contentSignature)
      .where(sql`${table.contentSignature} IS NOT NULL`),
    index('lms_bank_type_tier_status_idx').on(table.type, table.tier, table.status),
  ]
);

/**
 * Curated club tenures for marquee managers (Ferguson, Mourinho, Guardiola…). Powers
 * "played under manager X" relationship prompts. Seasons are season-start years
 * (2008 = 2008/09). season_to NULL = ongoing. Derived against player_stats by club +
 * season overlap; we only ever curate famous managers, so quality beats scraping.
 */
export const managerTenures = pgTable(
  'manager_tenures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    manager: text('manager').notNull(),
    managerNorm: text('manager_norm').notNull(),
    club: text('club').notNull(),
    clubNorm: text('club_norm').notNull(),
    seasonFrom: integer('season_from').notNull(),
    seasonTo: integer('season_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('manager_tenures_unique').on(table.managerNorm, table.clubNorm, table.seasonFrom),
    index('manager_tenures_manager_idx').on(table.managerNorm),
  ]
);

/**
 * Per-player appearances in major finals (Champions League / World Cup / Euro), scraped
 * from FBref match reports. Powers "scored in a CL final", "started a World Cup final",
 * "played in a Champions League final", "won the …" relationship prompts. season =
 * season-start year. `won` = their team won that final.
 */
export const finalAppearances = pgTable(
  'final_appearances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }),
    playerName: text('player_name').notNull(),
    competition: text('competition').notNull(), // Champions League | World Cup | Euro
    season: integer('season').notNull(),
    team: text('team').notNull(),
    started: boolean('started').notNull().default(false),
    minutes: integer('minutes').notNull().default(0),
    goals: integer('goals').notNull().default(0),
    won: boolean('won').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('final_appearances_unique').on(
      table.competition,
      table.season,
      table.playerName,
      table.team
    ),
    index('final_appearances_player_idx').on(table.playerId),
    index('final_appearances_comp_idx').on(table.competition, table.season),
  ]
);

/**
 * Individual awards scraped from Wikipedia list articles (Ballon d'Or podium, European
 * Golden Shoe, World Cup Golden Boot, PFA/UEFA Team of the Year, FIFPro World XI, Young
 * Player…). Powers "won the Golden Boot", "Ballon d'Or podium", "UEFA Team of the Year"
 * style prompts across modes. placement: winner | 1st | 2nd | 3rd | xi.
 */
export const playerAwards = pgTable(
  'player_awards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }),
    playerName: text('player_name').notNull(),
    award: text('award').notNull(),
    year: integer('year').notNull(),
    placement: text('placement').notNull().default('winner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('player_awards_unique').on(table.award, table.year, table.playerName, table.placement),
    index('player_awards_player_idx').on(table.playerId),
    index('player_awards_award_idx').on(table.award),
  ]
);

/**
 * Per-player aggregates derived from the Transfermarkt match-level dump (appearances +
 * game_events + games), which our season-total ingest can't express. Built offline by
 * `job:ingest-tm-events`. Powers categories like penalty goals, CL knockout goals, hat-tricks,
 * goals vs English clubs in the CL, weak-foot goals, and exact-age milestones.
 */
export const playerExtraStats = pgTable('player_extra_stats', {
  playerId: uuid('player_id')
    .primaryKey()
    .references(() => players.id, { onDelete: 'cascade' }),
  penaltyGoals: integer('penalty_goals').notNull().default(0),
  weakFootGoals: integer('weak_foot_goals').notNull().default(0),
  careerHattricks: integer('career_hattricks').notNull().default(0),
  uclKnockoutGoals: integer('ucl_knockout_goals').notNull().default(0),
  uclGoalsVsEnglish: integer('ucl_goals_vs_english').notNull().default(0),
  uclRedCards: integer('ucl_red_cards').notNull().default(0),
  goalsBefore21: integer('goals_before_21').notNull().default(0),
  firstGoalAgeDays: integer('first_goal_age_days'),
  debutAgeDays: integer('debut_age_days'),
  intlCaps: integer('intl_caps').notNull().default(0),
  /** International goals from the Wikipedia 50+ goals / 100+ caps lists (ingest-intl-stats-wiki). */
  intlGoals: integer('intl_goals').notNull().default(0),
  /** Penalty goals PER LEAGUE from FBref (all eras), so categories can be precise and accurate
   *  ("Premier League penalties") rather than a fuzzy, undercounted all-competitions "career"
   *  total. fbrefPenalties (Big-5 sum) is retained but no longer drives a category. */
  fbrefPenalties: integer('fbref_penalties').notNull().default(0),
  plPenalties: integer('pl_penalties').notNull().default(0),
  laligaPenalties: integer('laliga_penalties').notNull().default(0),
  serieaPenalties: integer('seriea_penalties').notNull().default(0),
  bundesligaPenalties: integer('bundesliga_penalties').notNull().default(0),
  ligue1Penalties: integer('ligue1_penalties').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * World Cup squads scraped from Wikipedia "YYYY FIFA World Cup squads" — one row per player
 * per tournament, with position, club, shirt number, caps, captaincy and the team's coach.
 * Powers World Cup XI generation (real squads + positions), captain/manager clues, and a
 * date-of-birth top-up for `players`. Built offline by `job:import-wc-squads`.
 */
export const wcSquads = pgTable(
  'wc_squads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    year: integer('year').notNull(),
    country: text('country').notNull(),
    playerId: uuid('player_id').references(() => players.id, { onDelete: 'set null' }),
    playerName: text('player_name').notNull(),
    position: text('position').notNull().default(''),
    shirtNumber: integer('shirt_number'),
    club: text('club'),
    caps: integer('caps'),
    isCaptain: boolean('is_captain').notNull().default(false),
    coach: text('coach'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('wc_squads_unique').on(table.year, table.country, table.playerName),
    index('wc_squads_player_idx').on(table.playerId),
  ]
);

/**
 * Match-level World Cup events (goals, own goals, cards, shootout penalties) with the match
 * date / stage / opponent, derived from StatsBomb open data (2018, 2022) and later Wikipedia
 * match reports (1994–2014). One row per event. Powers the "witty" per-match clues: who scored
 * in the semi-final, braces vs a team, hat-tricks, own goals, youngest scorer (date + DOB),
 * booked-every-game, shootout scorers/saves, and final/match assists.
 */
export const wcMatchEvents = pgTable(
  'wc_match_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    year: integer('year').notNull(),
    matchId: integer('match_id').notNull(),
    matchDate: date('match_date'),
    stage: text('stage').notNull().default(''),
    team: text('team').notNull(),
    opponent: text('opponent').notNull().default(''),
    playerId: uuid('player_id').references(() => players.id, { onDelete: 'set null' }),
    playerName: text('player_name').notNull(),
    type: text('type').notNull(), // goal | own_goal | card | shootout_pen | shootout_save
    minute: integer('minute'),
    detail: text('detail'), // 'penalty' | 'Yellow Card' | 'Red Card' | 'scored'/'saved'/'missed'
    assistPlayerId: uuid('assist_player_id').references(() => players.id, { onDelete: 'set null' }),
    assistPlayerName: text('assist_player_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('wc_match_events_player_idx').on(table.playerId),
    index('wc_match_events_year_type_idx').on(table.year, table.type),
  ]
);

/**
 * Curated "memorable World Cup moments" clue bank for the World Cup XI game. Claude proposes
 * story-led clues per tournament (build-wc-memorable), each DB-verified to a player in that
 * year's squad, then human-QA'd (status active|rejected) via the review CSV. The generator
 * prefers these over auto-generated structured clues.
 */
export const wcMemorable = pgTable(
  'wc_memorable',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    year: integer('year').notNull(),
    playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }),
    playerName: text('player_name').notNull(),
    position: text('position').notNull().default(''),
    clue: text('clue').notNull(),
    status: text('status').notNull().default('active'), // active | rejected
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('wc_memorable_unique').on(table.year, table.playerId),
    index('wc_memorable_year_status_idx').on(table.year, table.status),
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
  (table) => [
    // One completion per user/day/mode — enforced in the DB so concurrent requests can't double-award XP.
    uniqueIndex('daily_completions_user_date_mode_unique').on(table.userId, table.date, table.modeId),
    index('daily_completions_user_date_idx').on(table.userId, table.date),
  ]
);

/** Per-user, per-day, per-mode XP ledger — powers daily/weekly/team/overall leagues. */
export const xpLedger = pgTable(
  'xp_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    modeId: text('mode_id').notNull(),
    xpEarned: integer('xp_earned').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('xp_ledger_user_date_mode_unique').on(table.userId, table.date, table.modeId),
    index('xp_ledger_date_idx').on(table.date),
    index('xp_ledger_user_idx').on(table.userId),
  ]
);

/** A weekly competition group (Bronze/Silver/Gold tier) of ~30 players. */
export const leagueCohorts = pgTable(
  'league_cohorts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tier: text('tier').notNull().default('bronze'),
    weekStart: date('week_start').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('league_cohorts_week_tier_idx').on(table.weekStart, table.tier)]
);

export const leagueMemberships = pgTable(
  'league_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cohortId: uuid('cohort_id')
      .notNull()
      .references(() => leagueCohorts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weekStart: date('week_start').notNull(),
  },
  (table) => [
    uniqueIndex('league_memberships_user_week_unique').on(table.userId, table.weekStart),
    index('league_memberships_cohort_idx').on(table.cohortId),
  ]
);

export type User = typeof users.$inferSelect;
export type XpLedgerEntry = typeof xpLedger.$inferSelect;
export type LeagueCohort = typeof leagueCohorts.$inferSelect;
export type LeagueMembership = typeof leagueMemberships.$inferSelect;
export type Player = typeof players.$inferSelect;
export type PlayerStat = typeof playerStats.$inferSelect;
export type PlayerTransfer = typeof playerTransfers.$inferSelect;
export type PlayerHonour = typeof playerHonours.$inferSelect;
export type PlayerCareerEntry = typeof playerCareer.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type DailyPuzzle = typeof dailyPuzzles.$inferSelect;
export type OpsGenerationRun = typeof opsGenerationRuns.$inferSelect;
export type OpsGenerationItem = typeof opsGenerationItems.$inferSelect;
export type OpsMedia = typeof opsMedia.$inferSelect;
export type QuestionTemplate = typeof questionTemplates.$inferSelect;
export type NewQuestionTemplate = typeof questionTemplates.$inferInsert;
export type ManagerTenure = typeof managerTenures.$inferSelect;
export type FinalAppearance = typeof finalAppearances.$inferSelect;
export type PlayerAward = typeof playerAwards.$inferSelect;
export type PlayerExtraStats = typeof playerExtraStats.$inferSelect;
export type WcSquad = typeof wcSquads.$inferSelect;
export type WcMatchEvent = typeof wcMatchEvents.$inferSelect;
export type WcMemorable = typeof wcMemorable.$inferSelect;
export type LmsBankRow = typeof lmsBank.$inferSelect;
