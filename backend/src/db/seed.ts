import { db } from './index.js';
import { players } from './schema.js';
import { generateAllDailyPuzzles } from '../jobs/generate-daily.js';
import { buildPlayerSearchFields } from '../utils/playerSearch.js';

const SEED_PLAYERS = [
  { name: 'Erling Haaland', nationality: 'Norway', position: 'Attacker', age: 24, currentClub: 'Manchester City', currentLeague: 'Premier League', shirtNumber: 9, marketValueTier: 5 },
  { name: 'Kylian Mbappé', nationality: 'France', position: 'Attacker', age: 26, currentClub: 'Real Madrid', currentLeague: 'La Liga', shirtNumber: 9, marketValueTier: 5 },
  { name: 'Bruno Fernandes', nationality: 'Portugal', position: 'Midfielder', age: 30, currentClub: 'Manchester United', currentLeague: 'Premier League', shirtNumber: 8, marketValueTier: 4 },
  { name: 'Virgil van Dijk', nationality: 'Netherlands', position: 'Defender', age: 33, currentClub: 'Liverpool', currentLeague: 'Premier League', shirtNumber: 4, marketValueTier: 4 },
  { name: 'Mohamed Salah', nationality: 'Egypt', position: 'Attacker', age: 32, currentClub: 'Liverpool', currentLeague: 'Premier League', shirtNumber: 11, marketValueTier: 5 },
  { name: 'Kevin De Bruyne', nationality: 'Belgium', position: 'Midfielder', age: 33, currentClub: 'Manchester City', currentLeague: 'Premier League', shirtNumber: 17, marketValueTier: 4 },
  { name: 'Harry Kane', nationality: 'England', position: 'Attacker', age: 31, currentClub: 'Bayern Munich', currentLeague: 'Bundesliga', shirtNumber: 9, marketValueTier: 5 },
  { name: 'Lamine Yamal', nationality: 'Spain', position: 'Attacker', age: 17, currentClub: 'Barcelona', currentLeague: 'La Liga', shirtNumber: 19, marketValueTier: 5 },
  { name: 'Jude Bellingham', nationality: 'England', position: 'Midfielder', age: 21, currentClub: 'Real Madrid', currentLeague: 'La Liga', shirtNumber: 5, marketValueTier: 5 },
  { name: 'Vinícius Júnior', nationality: 'Brazil', position: 'Attacker', age: 24, currentClub: 'Real Madrid', currentLeague: 'La Liga', shirtNumber: 7, marketValueTier: 5 },
  { name: 'Bukayo Saka', nationality: 'England', position: 'Attacker', age: 23, currentClub: 'Arsenal', currentLeague: 'Premier League', shirtNumber: 7, marketValueTier: 4 },
  { name: 'Rodri', nationality: 'Spain', position: 'Midfielder', age: 28, currentClub: 'Manchester City', currentLeague: 'Premier League', shirtNumber: 16, marketValueTier: 4 },
  { name: 'Declan Rice', nationality: 'England', position: 'Midfielder', age: 26, currentClub: 'Arsenal', currentLeague: 'Premier League', shirtNumber: 41, marketValueTier: 4 },
  { name: 'Victor Osimhen', nationality: 'Nigeria', position: 'Attacker', age: 26, currentClub: 'Galatasaray', currentLeague: 'Super Lig', shirtNumber: 45, marketValueTier: 4 },
  { name: 'Rafael Leão', nationality: 'Portugal', position: 'Attacker', age: 25, currentClub: 'AC Milan', currentLeague: 'Serie A', shirtNumber: 10, marketValueTier: 4 },
  { name: 'Alisson', nationality: 'Brazil', position: 'Goalkeeper', age: 32, currentClub: 'Liverpool', currentLeague: 'Premier League', shirtNumber: 1, marketValueTier: 3 },
  { name: 'Thibaut Courtois', nationality: 'Belgium', position: 'Goalkeeper', age: 32, currentClub: 'Real Madrid', currentLeague: 'La Liga', shirtNumber: 1, marketValueTier: 3 },
  { name: 'Achraf Hakimi', nationality: 'Morocco', position: 'Defender', age: 26, currentClub: 'Paris Saint Germain', currentLeague: 'Ligue 1', shirtNumber: 2, marketValueTier: 4 },
  { name: 'Ousmane Dembélé', nationality: 'France', position: 'Attacker', age: 27, currentClub: 'Paris Saint Germain', currentLeague: 'Ligue 1', shirtNumber: 10, marketValueTier: 4 },
  { name: 'Cristiano Ronaldo', nationality: 'Portugal', position: 'Attacker', age: 40, currentClub: 'Al Nassr', currentLeague: 'Pro League', shirtNumber: 7, marketValueTier: 3 },
  { name: 'Lionel Messi', nationality: 'Argentina', position: 'Attacker', age: 37, currentClub: 'Inter Miami', currentLeague: 'MLS', shirtNumber: 10, marketValueTier: 4 },
  { name: 'Robert Lewandowski', nationality: 'Poland', position: 'Attacker', age: 36, currentClub: 'Barcelona', currentLeague: 'La Liga', shirtNumber: 9, marketValueTier: 3 },
  { name: 'Pedri', nationality: 'Spain', position: 'Midfielder', age: 22, currentClub: 'Barcelona', currentLeague: 'La Liga', shirtNumber: 8, marketValueTier: 4 },
  { name: 'Gavi', nationality: 'Spain', position: 'Midfielder', age: 20, currentClub: 'Barcelona', currentLeague: 'La Liga', shirtNumber: 6, marketValueTier: 4 },
  { name: 'Phil Foden', nationality: 'England', position: 'Midfielder', age: 24, currentClub: 'Manchester City', currentLeague: 'Premier League', shirtNumber: 47, marketValueTier: 4 },
  { name: 'Martin Ødegaard', nationality: 'Norway', position: 'Midfielder', age: 26, currentClub: 'Arsenal', currentLeague: 'Premier League', shirtNumber: 8, marketValueTier: 4 },
  { name: 'William Saliba', nationality: 'France', position: 'Defender', age: 23, currentClub: 'Arsenal', currentLeague: 'Premier League', shirtNumber: 2, marketValueTier: 4 },
  { name: 'Trent Alexander-Arnold', nationality: 'England', position: 'Defender', age: 26, currentClub: 'Liverpool', currentLeague: 'Premier League', shirtNumber: 66, marketValueTier: 4 },
  { name: 'Son Heung-min', nationality: 'South Korea', position: 'Attacker', age: 32, currentClub: 'Tottenham', currentLeague: 'Premier League', shirtNumber: 7, marketValueTier: 4 },
  { name: 'Antoine Griezmann', nationality: 'France', position: 'Attacker', age: 33, currentClub: 'Atletico Madrid', currentLeague: 'La Liga', shirtNumber: 7, marketValueTier: 3 },
];

function buildAliases(name: string): string[] {
  return buildPlayerSearchFields(name).aliases;
}

function normalizeSearchText(name: string): string {
  return buildPlayerSearchFields(name).searchText;
}

export async function seedPlayersIfEmpty(): Promise<void> {
  const existing = await db.select().from(players).limit(1);
  if (existing.length > 0) {
    console.log('Players already seeded, skipping');
    return;
  }

  await db.insert(players).values(
    SEED_PLAYERS.map((p) => ({
      ...p,
      aliases: buildAliases(p.name),
      searchText: normalizeSearchText(p.name),
    }))
  );

  console.log(`Seeded ${SEED_PLAYERS.length} players`);
}

export async function bootstrapDatabase(): Promise<void> {
  await seedPlayersIfEmpty();
  const today = new Date().toISOString().slice(0, 10);
  await generateAllDailyPuzzles(today);
  console.log('Database bootstrap complete');
}
