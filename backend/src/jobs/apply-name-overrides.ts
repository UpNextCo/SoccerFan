/**
 * Curated display-name overrides for famous players whose stored name is the full
 * legal name and whose common name shares no tokens with it (so automated matching
 * can't fix them) — e.g. "Cristiano dos Santos Aveiro" → "Cristiano Ronaldo".
 *
 * Keyed by exact stored name + nationality (safe, precise). Keeps the old name in
 * aliases/search_text so search still finds them.
 *
 * Usage: DATABASE_URL=... npm run job:apply-name-overrides
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

// [stored name, nationality, common name]
const OVERRIDES: Array<[string, string, string]> = [
  ['Cristiano dos Santos Aveiro', 'Portugal', 'Cristiano Ronaldo'],
  ['Roberto Barbosa de Oliveira', 'Brazil', 'Roberto Firmino'],
  ['Daniel Tackie Mensah Welbeck', 'England', 'Danny Welbeck'],
  ['João Iria Santos Moutinho', 'Portugal', 'João Moutinho'],
  ['Willian Borges da Silva', 'Brazil', 'Willian'],
  ['Francesc Fàbregas i Soler', 'Spain', 'Cesc Fàbregas'],
  ['Marcelo Vieira da Silva Júnior', 'Brazil', 'Marcelo'],
  ['Lucas Rodrigues Moura da Silva', 'Brazil', 'Lucas Moura'],
  ['Felipe Anderson Pereira Gomes', 'Brazil', 'Felipe Anderson'],
  ['Ederson Santana de Moraes', 'Brazil', 'Ederson'],
  ['José Giménez de Vargas', 'Uruguay', 'José Giménez'],
  ['Daniel Alves da Silva', 'Brazil', 'Dani Alves'],
  ['Matheus Carneiro da Cunha', 'Brazil', 'Matheus Cunha'],
  ['Neymar da Silva Santos Júnior', 'Brazil', 'Neymar'],
  ['André Valente da Silva', 'Portugal', 'André Silva'],
  ['Rui dos Santos Patrício', 'Portugal', 'Rui Patrício'],
  ['Joelinton Apolinário de Lira', 'Brazil', 'Joelinton'],
  ['Képler de Lima Ferreira', 'Portugal', 'Pepe'],
  ['Emerson Palmieri dos Santos', 'Italy', 'Emerson Palmieri'],
  ['Rafael Pereira da Silva', 'Brazil', 'Rafael'],
  ['Diogo Teixeira da Silva', 'Portugal', 'Diogo Jota'],
  ['Lucas Tolentino Coelho de Lima', 'Brazil', 'Lucas Paquetá'],
  ['Bruno Guimarães Rodriguez Moura', 'Brazil', 'Bruno Guimarães'],
  ['Rodrygo Silva de Goes', 'Brazil', 'Rodrygo'],
  ['Rafael Alcântara do Nascimento', 'Brazil', 'Rafinha'],
  ['Bernardo Fernandes da Silva Junior', 'Brazil', 'Bernardo'],
  ['Ramires Santos do Nascimento', 'Brazil', 'Ramires'],
  ['Frederico Rodrigues de Paula Santos', 'Brazil', 'Fred'],
  ['Maxwell Scherrer Cabelino Andrade', 'Brazil', 'Maxwell'],
  ['Luís Almeida da Cunha', 'Portugal', 'Nani'],
  ['Emerson Leite de Souza Júnior', 'Brazil', 'Emerson Royal'],
  ['Bruno da Silva Peres', 'Brazil', 'Bruno Peres'],
  ['Sergio García de la Fuente', 'Spain', 'Sergio García'],
];

async function main() {
  let updated = 0;
  for (const [oldName, nat, newName] of OVERRIDES) {
    const search = normalizeSearchText(`${oldName} ${newName}`);
    const res = await db.execute(sql`
      UPDATE players
      SET name = ${newName},
          aliases = (
            SELECT to_jsonb(array(SELECT DISTINCT unnest(
              COALESCE(array(SELECT jsonb_array_elements_text(aliases)), ARRAY[]::text[]) || ARRAY[${oldName}, ${newName}]
            )))
          ),
          search_text = search_text || ' ' || ${search}
      WHERE name = ${oldName} AND nationality = ${nat}
      RETURNING id
    `);
    if (res.length > 0) {
      updated += 1;
      console.log(`  ${oldName} → ${newName}`);
    } else {
      console.log(`  (no match) ${oldName}`);
    }
  }
  console.log(`\nApplied ${updated}/${OVERRIDES.length} name overrides.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
