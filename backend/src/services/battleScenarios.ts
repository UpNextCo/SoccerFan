/**
 * Battle Mode catalog + the deterministic match model.
 *
 * The game hands the player a SCENARIO (a famous match-up with a budget) and a FORMATION. They fill
 * position-locked slots with real players within the budget, then a transparent power model turns
 * their XI vs the opponent's XI into a scoreline. Goals are flavour: minutes + scorers are seeded by
 * the puzzle id so the result is deterministic (shareable) yet feels alive.
 *
 * The same model is mirrored on iOS (Domain/DraftMasterModels.swift -> BattleSim). Keep the
 * constants here and there in sync. Opponent player values are tuned "prime strength" figures (so
 * legends rate as strong), independent of the live Transfermarkt prices the player spends from.
 */

export type Bucket = 'GK' | 'DEF' | 'MID' | 'ATT';

const M = 1_000_000;

export interface RatedPlayer {
  bucket: Bucket;
  valueEur: number;
}

export interface OpponentPlayer extends RatedPlayer {
  name: string;
}

export interface BattleScenario {
  id: string;
  /** Headline competition / situation, e.g. "Champions League Final". */
  title: string;
  /** The objective, e.g. "Beat prime Barcelona". */
  subtitle: string;
  /** One or two sentences of stakes. */
  narrative: string;
  competition: string;
  /** Transfer budget in EUR. The core difficulty lever (tuned vs opponent power). */
  budgetEur: number;
  opponent: { name: string; players: OpponentPlayer[] };
}

export interface BattleFormation {
  id: string;
  name: string;
  /** Eleven position buckets in slot order (iOS owns the fine labels + pitch coordinates). */
  slots: Bucket[];
}

// ---------------------------------------------------------------------------
// Match model (mirror on iOS)
// ---------------------------------------------------------------------------

/** Per-bucket contribution to attack / defence. */
export const POSITION_WEIGHTS: Record<Bucket, { atk: number; def: number }> = {
  GK: { atk: 0.0, def: 1.0 },
  DEF: { atk: 0.12, def: 0.9 },
  MID: { atk: 0.55, def: 0.5 },
  ATT: { atk: 1.0, def: 0.15 },
};

/** Compressive price -> strength curve: EUR1M -> 1, EUR50M -> ~11, EUR200M -> ~25. */
export function strength(valueEur: number): number {
  return Math.pow(Math.max(valueEur, 0) / M, 0.62);
}

export interface Ratings {
  attack: number;
  defence: number;
  power: number;
}

export function rateXi(players: RatedPlayer[]): Ratings {
  let attack = 0;
  let defence = 0;
  for (const p of players) {
    const s = strength(p.valueEur);
    const w = POSITION_WEIGHTS[p.bucket];
    attack += s * w.atk;
    defence += s * w.def;
  }
  return { attack, defence, power: attack + defence };
}

// Goal model: scale-free ratio of your attack to their defence, so it is robust to value
// approximations. Equal sides settle around a 1-1 / 1-0 feel.
const GOAL_BASE = 1.5;
const GOAL_EXP = 1.6;
const MAX_GOALS = 7;

export function expectedGoals(attack: number, oppDefence: number): number {
  return GOAL_BASE * Math.pow(attack / Math.max(oppDefence, 1), GOAL_EXP);
}

/** Deterministic 0..1 from a string seed. */
export function seedRand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // xorshift to spread the bits
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return ((h >>> 0) % 100000) / 100000;
}

/** Probabilistic rounding seeded by the puzzle: floor(xg + u), capped. */
export function seededGoals(xg: number, seed: string): number {
  const g = Math.floor(Math.max(xg, 0) + seedRand(seed));
  return Math.min(g, MAX_GOALS);
}

export type MatchResult = 'win' | 'draw' | 'loss';

export interface GoalEvent {
  scorer: string;
  minute: number; // 1..90
  stoppage: number; // 0 unless added time
  forYou: boolean;
}

export interface SimOutcome {
  yourGoals: number;
  theirGoals: number;
  result: MatchResult;
  yourRatings: Ratings;
  oppRatings: Ratings;
  events: GoalEvent[];
}

/**
 * Simulate the player's XI (each pick: bucket + the live priceEur they paid) against the scenario
 * opponent. `seed` should be the puzzleId so the same XI always yields the same result.
 */
export function simulate(
  yourXi: Array<RatedPlayer & { name: string }>,
  opponent: { players: OpponentPlayer[] },
  seed: string
): SimOutcome {
  const yourRatings = rateXi(yourXi);
  const oppRatings = rateXi(opponent.players);

  const yourGoals = seededGoals(expectedGoals(yourRatings.attack, oppRatings.defence), `${seed}:you`);
  const theirGoals = seededGoals(expectedGoals(oppRatings.attack, yourRatings.defence), `${seed}:opp`);

  const result: MatchResult = yourGoals > theirGoals ? 'win' : yourGoals < theirGoals ? 'loss' : 'draw';

  const events: GoalEvent[] = [
    ...pickScorers(yourXi, yourGoals, `${seed}:yg`, true),
    ...pickScorers(opponent.players, theirGoals, `${seed}:tg`, false),
  ].sort((a, b) => a.minute + a.stoppage / 10 - (b.minute + b.stoppage / 10));

  return { yourGoals, theirGoals, result, yourRatings, oppRatings, events };
}

function pickScorers(
  players: Array<RatedPlayer & { name: string }>,
  goals: number,
  seed: string,
  forYou: boolean
): GoalEvent[] {
  if (goals <= 0) return [];
  // Attacking weight per player; everyone can score but forwards dominate.
  const weights = players.map((p) => Math.max(strength(p.valueEur) * (POSITION_WEIGHTS[p.bucket].atk + 0.05), 0.01));
  const total = weights.reduce((a, b) => a + b, 0);
  const out: GoalEvent[] = [];
  const usedMinutes = new Set<number>();
  for (let i = 0; i < goals; i += 1) {
    const r = seedRand(`${seed}:s${i}`) * total;
    let acc = 0;
    let idx = 0;
    for (let j = 0; j < weights.length; j += 1) {
      acc += weights[j]!;
      if (r <= acc) { idx = j; break; }
    }
    let minute = 1 + Math.floor(seedRand(`${seed}:m${i}`) * 90);
    while (usedMinutes.has(minute)) minute = (minute % 90) + 1;
    usedMinutes.add(minute);
    const isStoppage = minute >= 88 && seedRand(`${seed}:st${i}`) > 0.6;
    out.push({
      scorer: players[idx]!.name,
      minute: isStoppage ? 90 : minute,
      stoppage: isStoppage ? 1 + Math.floor(seedRand(`${seed}:sa${i}`) * 5) : 0,
      forYou,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formations (iOS owns fine labels + pitch coordinates by id)
// ---------------------------------------------------------------------------

export const FORMATIONS: BattleFormation[] = [
  { id: '4-3-3', name: '4-3-3', slots: ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'ATT', 'ATT', 'ATT'] },
  { id: '4-4-2', name: '4-4-2', slots: ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'ATT', 'ATT'] },
  { id: '4-2-3-1', name: '4-2-3-1', slots: ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'MID', 'ATT'] },
  { id: '3-5-2', name: '3-5-2', slots: ['GK', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'MID', 'ATT', 'ATT'] },
  { id: '4-3-1-2', name: '4-3-1-2', slots: ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'ATT', 'ATT'] },
];

// ---------------------------------------------------------------------------
// Scenario catalog
// ---------------------------------------------------------------------------

function op(name: string, bucket: Bucket, valueM: number): OpponentPlayer {
  return { name, bucket, valueEur: valueM * M };
}

export const SCENARIOS: BattleScenario[] = [
  {
    id: 'ucl-barca-2011',
    title: 'Champions League Final',
    subtitle: 'Beat prime Barcelona',
    narrative: 'Wembley, 2011. Guardiola\'s Barcelona are at their tiki-taka peak. Build an XI and stop them.',
    competition: 'UEFA Champions League',
    budgetEur: 840 * M,
    opponent: {
      name: 'Barcelona (2011)',
      players: [
        op('Víctor Valdés', 'GK', 22), op('Dani Alves', 'DEF', 45), op('Gerard Piqué', 'DEF', 55),
        op('Carles Puyol', 'DEF', 30), op('Eric Abidal', 'DEF', 25), op('Sergio Busquets', 'MID', 70),
        op('Xavi', 'MID', 70), op('Andrés Iniesta', 'MID', 90), op('Pedro', 'ATT', 45),
        op('Lionel Messi', 'ATT', 200), op('David Villa', 'ATT', 50),
      ],
    },
  },
  {
    id: 'ucl-real-2017',
    title: 'Champions League Final',
    subtitle: 'Beat the Real Madrid three-peat side',
    narrative: 'Cardiff, 2017. Zidane\'s Madrid are chasing back-to-back-to-back European crowns.',
    competition: 'UEFA Champions League',
    budgetEur: 810 * M,
    opponent: {
      name: 'Real Madrid (2017)',
      players: [
        op('Keylor Navas', 'GK', 20), op('Dani Carvajal', 'DEF', 35), op('Sergio Ramos', 'DEF', 45),
        op('Raphaël Varane', 'DEF', 55), op('Marcelo', 'DEF', 45), op('Casemiro', 'MID', 55),
        op('Toni Kroos', 'MID', 75), op('Luka Modrić', 'MID', 70), op('Isco', 'ATT', 60),
        op('Cristiano Ronaldo', 'ATT', 120), op('Karim Benzema', 'ATT', 65),
      ],
    },
  },
  {
    id: 'ucl-bayern-2020',
    title: 'Champions League Final',
    subtitle: 'Beat the treble-winning Bayern',
    narrative: 'Lisbon, 2020. Flick\'s Bayern are steamrolling Europe. They put eight past Barça to get here.',
    competition: 'UEFA Champions League',
    budgetEur: 840 * M,
    opponent: {
      name: 'Bayern Munich (2020)',
      players: [
        op('Manuel Neuer', 'GK', 35), op('Joshua Kimmich', 'DEF', 80), op('Jérôme Boateng', 'DEF', 30),
        op('David Alaba', 'DEF', 55), op('Alphonso Davies', 'DEF', 70), op('Leon Goretzka', 'MID', 60),
        op('Thiago', 'MID', 65), op('Thomas Müller', 'MID', 45), op('Serge Gnabry', 'ATT', 70),
        op('Robert Lewandowski', 'ATT', 100), op('Kingsley Coman', 'ATT', 55),
      ],
    },
  },
  {
    id: 'ucl-milan-2007',
    title: 'Champions League Final',
    subtitle: 'Beat Ancelotti\'s Milan',
    narrative: 'Athens, 2007. Kaká is the best player on the planet and Milan want revenge for Istanbul.',
    competition: 'UEFA Champions League',
    budgetEur: 520 * M,
    opponent: {
      name: 'AC Milan (2007)',
      players: [
        op('Dida', 'GK', 18), op('Massimo Oddo', 'DEF', 15), op('Alessandro Nesta', 'DEF', 45),
        op('Paolo Maldini', 'DEF', 30), op('Marek Jankulovski', 'DEF', 15), op('Gennaro Gattuso', 'MID', 35),
        op('Andrea Pirlo', 'MID', 65), op('Clarence Seedorf', 'MID', 45), op('Kaká', 'MID', 100),
        op('Filippo Inzaghi', 'ATT', 35), op('Alberto Gilardino', 'ATT', 35),
      ],
    },
  },
  {
    id: 'ucl-utd-2008',
    title: 'Champions League Final',
    subtitle: 'Beat Ferguson\'s Manchester United',
    narrative: 'Moscow, 2008. Ronaldo and Rooney lead a relentless United side in the rain.',
    competition: 'UEFA Champions League',
    budgetEur: 620 * M,
    opponent: {
      name: 'Manchester United (2008)',
      players: [
        op('Edwin van der Sar', 'GK', 18), op('Wes Brown', 'DEF', 18), op('Rio Ferdinand', 'DEF', 45),
        op('Nemanja Vidić', 'DEF', 45), op('Patrice Evra', 'DEF', 35), op('Owen Hargreaves', 'MID', 30),
        op('Michael Carrick', 'MID', 35), op('Paul Scholes', 'MID', 35), op('Cristiano Ronaldo', 'ATT', 110),
        op('Wayne Rooney', 'ATT', 70), op('Carlos Tévez', 'ATT', 55),
      ],
    },
  },
  {
    id: 'ucl-liverpool-2019',
    title: 'Champions League Final',
    subtitle: 'Beat Klopp\'s Liverpool',
    narrative: 'Madrid, 2019. The heavy-metal Liverpool of Salah, Mané and Van Dijk are European kings in waiting.',
    competition: 'UEFA Champions League',
    budgetEur: 1030 * M,
    opponent: {
      name: 'Liverpool (2019)',
      players: [
        op('Alisson', 'GK', 75), op('Trent Alexander-Arnold', 'DEF', 75), op('Joël Matip', 'DEF', 30),
        op('Virgil van Dijk', 'DEF', 90), op('Andrew Robertson', 'DEF', 65), op('Fabinho', 'MID', 60),
        op('Jordan Henderson', 'MID', 40), op('Georginio Wijnaldum', 'MID', 45), op('Mohamed Salah', 'ATT', 150),
        op('Roberto Firmino', 'ATT', 75), op('Sadio Mané', 'ATT', 120),
      ],
    },
  },
  {
    id: 'pl-city-2023',
    title: 'Premier League Title Decider',
    subtitle: 'Beat the treble-winning Man City',
    narrative: 'The final day. Win and the title is yours; Guardiola\'s centurions-in-spirit have other ideas.',
    competition: 'Premier League',
    budgetEur: 1050 * M,
    opponent: {
      name: 'Manchester City (2023)',
      players: [
        op('Ederson', 'GK', 50), op('Kyle Walker', 'DEF', 30), op('Rúben Dias', 'DEF', 75),
        op('John Stones', 'DEF', 45), op('Nathan Aké', 'DEF', 40), op('Rodri', 'MID', 80),
        op('Kevin De Bruyne', 'MID', 100), op('Bernardo Silva', 'MID', 80), op('Jack Grealish', 'ATT', 70),
        op('Erling Haaland', 'ATT', 180), op('Phil Foden', 'ATT', 90),
      ],
    },
  },
  {
    id: 'ucl-psg-2023',
    title: 'Champions League Quarter-Final',
    subtitle: 'Knock out the PSG galácticos',
    narrative: 'Paris. Mbappé, Messi and Neymar share a pitch. One night to send the superstars home.',
    competition: 'UEFA Champions League',
    budgetEur: 980 * M,
    opponent: {
      name: 'Paris Saint-Germain (2023)',
      players: [
        op('Gianluigi Donnarumma', 'GK', 60), op('Achraf Hakimi', 'DEF', 70), op('Marquinhos', 'DEF', 65),
        op('Sergio Ramos', 'DEF', 20), op('Nuno Mendes', 'DEF', 55), op('Marco Verratti', 'MID', 60),
        op('Vitinha', 'MID', 55), op('Fabián Ruiz', 'MID', 45), op('Lionel Messi', 'ATT', 90),
        op('Kylian Mbappé', 'ATT', 180), op('Neymar', 'ATT', 90),
      ],
    },
  },
  {
    id: 'pl-arsenal-2004',
    title: 'Premier League Showdown',
    subtitle: 'End the Invincibles\' unbeaten run',
    narrative: 'Highbury, 2004. Wenger\'s Arsenal haven\'t lost all season. Be the team that finally does it.',
    competition: 'Premier League',
    budgetEur: 510 * M,
    opponent: {
      name: 'Arsenal (2004)',
      players: [
        op('Jens Lehmann', 'GK', 15), op('Lauren', 'DEF', 18), op('Kolo Touré', 'DEF', 25),
        op('Sol Campbell', 'DEF', 30), op('Ashley Cole', 'DEF', 35), op('Patrick Vieira', 'MID', 55),
        op('Gilberto Silva', 'MID', 25), op('Robert Pirès', 'MID', 45), op('Freddie Ljungberg', 'MID', 35),
        op('Thierry Henry', 'ATT', 90), op('Dennis Bergkamp', 'ATT', 45),
      ],
    },
  },
  {
    id: 'top4-villa',
    title: 'Top-Four Race',
    subtitle: 'Beat Aston Villa to clinch 4th',
    narrative: 'Champions League football is on the line. Out-gun a stubborn, well-drilled Villa.',
    competition: 'Premier League',
    budgetEur: 680 * M,
    opponent: {
      name: 'Aston Villa',
      players: [
        op('Emiliano Martínez', 'GK', 35), op('Matty Cash', 'DEF', 22), op('Ezri Konsa', 'DEF', 35),
        op('Pau Torres', 'DEF', 40), op('Lucas Digne', 'DEF', 18), op('Boubacar Kamara', 'MID', 45),
        op('Douglas Luiz', 'MID', 50), op('John McGinn', 'MID', 35), op('Leon Bailey', 'ATT', 40),
        op('Ollie Watkins', 'ATT', 60), op('Moussa Diaby', 'ATT', 50),
      ],
    },
  },
  {
    id: 'top4-spurs',
    title: 'Top-Four Race',
    subtitle: 'Beat Tottenham to finish 4th',
    narrative: 'A six-pointer for the final Champions League spot. Spurs are dangerous on the break.',
    competition: 'Premier League',
    budgetEur: 800 * M,
    opponent: {
      name: 'Tottenham',
      players: [
        op('Guglielmo Vicario', 'GK', 35), op('Pedro Porro', 'DEF', 45), op('Cristian Romero', 'DEF', 55),
        op('Micky van de Ven', 'DEF', 50), op('Destiny Udogie', 'DEF', 45), op('Yves Bissouma', 'MID', 35),
        op('Pape Matar Sarr', 'MID', 35), op('James Maddison', 'MID', 55), op('Dejan Kulusevski', 'ATT', 50),
        op('Heung-min Son', 'ATT', 60), op('Richarlison', 'ATT', 40),
      ],
    },
  },
  {
    id: 'top4-newcastle',
    title: 'Top-Four Race',
    subtitle: 'Beat Newcastle to grab 4th',
    narrative: 'St James\' Park is rocking. Survive the noise and the press to take the points.',
    competition: 'Premier League',
    budgetEur: 710 * M,
    opponent: {
      name: 'Newcastle',
      players: [
        op('Nick Pope', 'GK', 25), op('Kieran Trippier', 'DEF', 25), op('Fabian Schär', 'DEF', 20),
        op('Sven Botman', 'DEF', 45), op('Dan Burn', 'DEF', 15), op('Bruno Guimarães', 'MID', 70),
        op('Sandro Tonali', 'MID', 55), op('Joelinton', 'MID', 45), op('Miguel Almirón', 'ATT', 35),
        op('Alexander Isak', 'ATT', 75), op('Anthony Gordon', 'ATT', 50),
      ],
    },
  },
  {
    id: 'europe-chelsea',
    title: 'Race for Europe',
    subtitle: 'Beat Chelsea for a European spot',
    narrative: 'A pricey Chelsea side is wildly inconsistent. Catch them on a good day and you are in trouble.',
    competition: 'Premier League',
    budgetEur: 770 * M,
    opponent: {
      name: 'Chelsea',
      players: [
        op('Robert Sánchez', 'GK', 20), op('Reece James', 'DEF', 45), op('Thiago Silva', 'DEF', 8),
        op('Levi Colwill', 'DEF', 45), op('Marc Cucurella', 'DEF', 25), op('Enzo Fernández', 'MID', 75),
        op('Moisés Caicedo', 'MID', 75), op('Conor Gallagher', 'MID', 45), op('Raheem Sterling', 'ATT', 45),
        op('Cole Palmer', 'ATT', 80), op('Nicolas Jackson', 'ATT', 45),
      ],
    },
  },
  {
    id: 'survive-brighton-burnley',
    title: 'Relegation Six-Pointer',
    subtitle: 'Survive as Brighton vs a rival',
    narrative: 'Two clubs, one drop. A scrappy, desperate fight where one goal could mean everything.',
    competition: 'Premier League',
    budgetEur: 240 * M,
    opponent: {
      name: 'Burnley',
      players: [
        op('James Trafford', 'GK', 15), op('Connor Roberts', 'DEF', 8), op('Dara O\'Shea', 'DEF', 12),
        op('Jordan Beyer', 'DEF', 10), op('Charlie Taylor', 'DEF', 5), op('Josh Cullen', 'MID', 12),
        op('Sander Berge', 'MID', 18), op('Josh Brownhill', 'MID', 8), op('Wilson Odobert', 'ATT', 15),
        op('Lyle Foster', 'ATT', 12), op('Zeki Amdouni', 'ATT', 15),
      ],
    },
  },
  {
    id: 'survive-luton-forest',
    title: 'Relegation Battle',
    subtitle: 'Beat the drop on a shoestring',
    narrative: 'You have the smallest budget in the league. Find value, dig in, and stay up.',
    competition: 'Premier League',
    budgetEur: 350 * M,
    opponent: {
      name: 'Nottingham Forest',
      players: [
        op('Matz Sels', 'GK', 8), op('Neco Williams', 'DEF', 15), op('Murillo', 'DEF', 30),
        op('Nikola Milenković', 'DEF', 18), op('Ola Aina', 'DEF', 10), op('Ryan Yates', 'MID', 10),
        op('Nicolás Domínguez', 'MID', 14), op('Morgan Gibbs-White', 'MID', 40), op('Anthony Elanga', 'ATT', 30),
        op('Chris Wood', 'ATT', 10), op('Callum Hudson-Odoi', 'ATT', 18),
      ],
    },
  },
  {
    id: 'survive-everton-leicester',
    title: 'Relegation Run-In',
    subtitle: 'Keep your club up',
    narrative: 'Points-deducted and backs against the wall. One result to spark the great escape.',
    competition: 'Premier League',
    budgetEur: 310 * M,
    opponent: {
      name: 'Leicester',
      players: [
        op('Mads Hermansen', 'GK', 14), op('James Justin', 'DEF', 18), op('Wout Faes', 'DEF', 18),
        op('Jannik Vestergaard', 'DEF', 8), op('Victor Kristiansen', 'DEF', 12), op('Wilfred Ndidi', 'MID', 20),
        op('Harry Winks', 'MID', 12), op('Kiernan Dewsbury-Hall', 'MID', 22), op('Stephy Mavididi', 'ATT', 18),
        op('Jamie Vardy', 'ATT', 8), op('Abdul Fatawu', 'ATT', 20),
      ],
    },
  },
  {
    id: 'facup-utd',
    title: 'FA Cup Final',
    subtitle: 'Lift the cup against Manchester United',
    narrative: 'Wembley arch, 90,000 fans. One match for a trophy and a place in history.',
    competition: 'FA Cup',
    budgetEur: 780 * M,
    opponent: {
      name: 'Manchester United',
      players: [
        op('André Onana', 'GK', 35), op('Diogo Dalot', 'DEF', 40), op('Raphaël Varane', 'DEF', 20),
        op('Lisandro Martínez', 'DEF', 45), op('Luke Shaw', 'DEF', 35), op('Casemiro', 'MID', 30),
        op('Kobbie Mainoo', 'MID', 55), op('Bruno Fernandes', 'MID', 70), op('Alejandro Garnacho', 'ATT', 55),
        op('Rasmus Højlund', 'ATT', 60), op('Marcus Rashford', 'ATT', 55),
      ],
    },
  },
  {
    id: 'clasico-real',
    title: 'El Clásico',
    subtitle: 'Win at the Bernabéu',
    narrative: 'The biggest club game on earth. Silence the home crowd and take the spoils.',
    competition: 'La Liga',
    budgetEur: 1210 * M,
    opponent: {
      name: 'Real Madrid',
      players: [
        op('Thibaut Courtois', 'GK', 45), op('Dani Carvajal', 'DEF', 20), op('Éder Militão', 'DEF', 55),
        op('Antonio Rüdiger', 'DEF', 30), op('Ferland Mendy', 'DEF', 25), op('Aurélien Tchouaméni', 'MID', 80),
        op('Federico Valverde', 'MID', 100), op('Jude Bellingham', 'MID', 180), op('Rodrygo', 'ATT', 100),
        op('Vinícius Júnior', 'ATT', 200), op('Kylian Mbappé', 'ATT', 180),
      ],
    },
  },
  {
    id: 'copadelrey-barca',
    title: 'Copa del Rey Final',
    subtitle: 'Beat Barcelona for the cup',
    narrative: 'A one-off final against a young, fearless Barça built around La Masia gems.',
    competition: 'Copa del Rey',
    budgetEur: 920 * M,
    opponent: {
      name: 'Barcelona',
      players: [
        op('Marc-André ter Stegen', 'GK', 40), op('Jules Koundé', 'DEF', 55), op('Ronald Araújo', 'DEF', 60),
        op('Pau Cubarsí', 'DEF', 45), op('Alejandro Balde', 'DEF', 50), op('Frenkie de Jong', 'MID', 70),
        op('Pedri', 'MID', 90), op('Gavi', 'MID', 70), op('Lamine Yamal', 'ATT', 180),
        op('Robert Lewandowski', 'ATT', 30), op('Raphinha', 'ATT', 60),
      ],
    },
  },
  {
    id: 'derby-arsenal',
    title: 'North London Derby',
    subtitle: 'Win the bragging rights',
    narrative: 'Pride, position and the whole city watching. Beat Arteta\'s Arsenal in a fierce derby.',
    competition: 'Premier League',
    budgetEur: 1020 * M,
    opponent: {
      name: 'Arsenal',
      players: [
        op('David Raya', 'GK', 35), op('Ben White', 'DEF', 55), op('William Saliba', 'DEF', 80),
        op('Gabriel', 'DEF', 60), op('Jurriën Timber', 'DEF', 45), op('Declan Rice', 'MID', 110),
        op('Martin Ødegaard', 'MID', 110), op('Kai Havertz', 'MID', 70), op('Bukayo Saka', 'ATT', 130),
        op('Gabriel Jesus', 'ATT', 55), op('Gabriel Martinelli', 'ATT', 65),
      ],
    },
  },
  {
    id: 'derby-inter',
    title: 'Derby della Madonnina',
    subtitle: 'Win the Milan derby',
    narrative: 'San Siro splits in two. Beat a hardened, tactical Inter side in front of the Curva.',
    competition: 'Serie A',
    budgetEur: 700 * M,
    opponent: {
      name: 'Inter',
      players: [
        op('Yann Sommer', 'GK', 12), op('Benjamin Pavard', 'DEF', 35), op('Alessandro Bastoni', 'DEF', 65),
        op('Francesco Acerbi', 'DEF', 6), op('Federico Dimarco', 'DEF', 45), op('Nicolò Barella', 'MID', 80),
        op('Hakan Çalhanoğlu', 'MID', 45), op('Henrikh Mkhitaryan', 'MID', 8), op('Marcus Thuram', 'ATT', 70),
        op('Lautaro Martínez', 'ATT', 90), op('Davide Frattesi', 'MID', 30),
      ],
    },
  },
  {
    id: 'europa-sevilla',
    title: 'Europa League Final',
    subtitle: 'Beat the kings of the Europa League',
    narrative: 'Sevilla never lose a Europa final. Be the team that breaks the curse.',
    competition: 'UEFA Europa League',
    budgetEur: 270 * M,
    opponent: {
      name: 'Sevilla',
      players: [
        op('Yassine Bounou', 'GK', 18), op('Jesús Navas', 'DEF', 6), op('Loïc Badé', 'DEF', 22),
        op('Nemanja Gudelj', 'DEF', 6), op('Marcos Acuña', 'DEF', 12), op('Fernando', 'MID', 8),
        op('Ivan Rakitić', 'MID', 10), op('Óliver Torres', 'MID', 12), op('Lucas Ocampos', 'ATT', 18),
        op('Youssef En-Nesyri', 'ATT', 30), op('Suso', 'ATT', 10),
      ],
    },
  },
  {
    id: 'bundesliga-dortmund',
    title: 'Bundesliga Klassiker',
    subtitle: 'Beat Borussia Dortmund',
    narrative: 'The Yellow Wall is in full voice. Out-run a fast, young Dortmund to claim the win.',
    competition: 'Bundesliga',
    budgetEur: 450 * M,
    opponent: {
      name: 'Borussia Dortmund',
      players: [
        op('Gregor Kobel', 'GK', 35), op('Julian Ryerson', 'DEF', 18), op('Mats Hummels', 'DEF', 6),
        op('Nico Schlotterbeck', 'DEF', 40), op('Ian Maatsen', 'DEF', 30), op('Emre Can', 'MID', 18),
        op('Marcel Sabitzer', 'MID', 20), op('Julian Brandt', 'MID', 40), op('Karim Adeyemi', 'ATT', 35),
        op('Niclas Füllkrug', 'ATT', 18), op('Donyell Malen', 'ATT', 35),
      ],
    },
  },
  {
    id: 'derby-liverpool',
    title: 'Merseyside Derby',
    subtitle: 'Topple Liverpool at Anfield',
    narrative: 'You Will Never Walk Alone rings out. Beat a gegen-pressing Liverpool on their own turf.',
    competition: 'Premier League',
    budgetEur: 810 * M,
    opponent: {
      name: 'Liverpool',
      players: [
        op('Alisson', 'GK', 45), op('Trent Alexander-Arnold', 'DEF', 70), op('Ibrahima Konaté', 'DEF', 45),
        op('Virgil van Dijk', 'DEF', 40), op('Andrew Robertson', 'DEF', 30), op('Alexis Mac Allister', 'MID', 70),
        op('Ryan Gravenberch', 'MID', 55), op('Dominik Szoboszlai', 'MID', 65), op('Mohamed Salah', 'ATT', 90),
        op('Luis Díaz', 'ATT', 70), op('Cody Gakpo', 'ATT', 55),
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Daily selection
// ---------------------------------------------------------------------------

function dayNumber(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
}

/** Deterministic daily scenario + formation. Scenario x formation gives months of variety. */
export function pickDaily(date: string): { scenario: BattleScenario; formation: BattleFormation } {
  const d = dayNumber(date);
  const scenario = SCENARIOS[d % SCENARIOS.length]!;
  // Offset the formation cycle by a different stride so scenario/formation pairings keep changing.
  const formation = FORMATIONS[(d * 3 + 1) % FORMATIONS.length]!;
  return { scenario, formation };
}
