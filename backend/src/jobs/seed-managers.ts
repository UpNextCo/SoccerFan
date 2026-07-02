/**
 * Seed curated manager → club tenures for marquee managers. Powers "played under X"
 * relationship prompts. Seasons are season-start years (2008 = 2008/09); `to: null`
 * means ongoing. We deliberately curate only famous managers (the only ones that make
 * fun prompts) — this beats scraping on quality and has zero anti-bot fragility.
 *
 * Pure DB, idempotent. Usage: DATABASE_URL=... npm run job:seed-managers
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normClub, playersUnderAll, unmatchedTenureClubs } from '../services/managerRules.js';

interface Spell {
  club: string;
  from: number;
  to: number | null;
}
interface Manager {
  name: string;
  spells: Spell[];
}

const MANAGERS: Manager[] = [
  {
    name: 'Pep Guardiola',
    spells: [
      { club: 'Barcelona', from: 2008, to: 2011 },
      { club: 'Bayern München', from: 2013, to: 2015 },
      { club: 'Manchester City', from: 2016, to: null },
    ],
  },
  {
    name: 'José Mourinho',
    spells: [
      { club: 'Porto', from: 2002, to: 2003 },
      { club: 'Chelsea', from: 2004, to: 2006 },
      { club: 'Inter', from: 2008, to: 2009 },
      { club: 'Real Madrid', from: 2010, to: 2012 },
      { club: 'Chelsea', from: 2013, to: 2015 },
      { club: 'Manchester United', from: 2016, to: 2018 },
      { club: 'Tottenham', from: 2019, to: 2020 },
      { club: 'Roma', from: 2021, to: 2023 },
    ],
  },
  {
    name: 'Carlo Ancelotti',
    spells: [
      { club: 'Juventus', from: 1999, to: 2000 },
      { club: 'AC Milan', from: 2001, to: 2008 },
      { club: 'Chelsea', from: 2009, to: 2010 },
      { club: 'Paris Saint Germain', from: 2011, to: 2012 },
      { club: 'Real Madrid', from: 2013, to: 2014 },
      { club: 'Bayern München', from: 2016, to: 2017 },
      { club: 'Napoli', from: 2018, to: 2019 },
      { club: 'Everton', from: 2019, to: 2020 },
      { club: 'Real Madrid', from: 2021, to: 2024 },
    ],
  },
  { name: 'Sir Alex Ferguson', spells: [{ club: 'Manchester United', from: 1986, to: 2012 }] },
  { name: 'Arsène Wenger', spells: [{ club: 'Arsenal', from: 1996, to: 2017 }] },
  {
    name: 'Jürgen Klopp',
    spells: [
      { club: 'Borussia Dortmund', from: 2008, to: 2014 },
      { club: 'Liverpool', from: 2015, to: 2023 },
    ],
  },
  {
    name: 'Zinedine Zidane',
    spells: [
      { club: 'Real Madrid', from: 2015, to: 2017 },
      { club: 'Real Madrid', from: 2019, to: 2020 },
    ],
  },
  {
    name: 'Antonio Conte',
    spells: [
      { club: 'Juventus', from: 2011, to: 2013 },
      { club: 'Chelsea', from: 2016, to: 2017 },
      { club: 'Inter', from: 2019, to: 2020 },
      { club: 'Tottenham', from: 2021, to: 2022 },
      { club: 'Napoli', from: 2024, to: null },
    ],
  },
  { name: 'Diego Simeone', spells: [{ club: 'Atletico Madrid', from: 2011, to: null }] },
  {
    name: 'Massimiliano Allegri',
    spells: [
      { club: 'AC Milan', from: 2010, to: 2013 },
      { club: 'Juventus', from: 2014, to: 2018 },
      { club: 'Juventus', from: 2021, to: 2023 },
    ],
  },
  {
    name: 'Rafael Benítez',
    spells: [
      { club: 'Valencia', from: 2001, to: 2003 },
      { club: 'Liverpool', from: 2004, to: 2009 },
      { club: 'Inter', from: 2010, to: 2010 },
      { club: 'Chelsea', from: 2012, to: 2012 },
      { club: 'Napoli', from: 2013, to: 2014 },
      { club: 'Real Madrid', from: 2015, to: 2015 },
      { club: 'Newcastle', from: 2016, to: 2018 },
    ],
  },
  {
    name: 'Louis van Gaal',
    spells: [
      { club: 'Barcelona', from: 1997, to: 1999 },
      { club: 'Bayern München', from: 2009, to: 2010 },
      { club: 'Manchester United', from: 2014, to: 2015 },
    ],
  },
  {
    name: 'Luis Enrique',
    spells: [
      { club: 'Barcelona', from: 2014, to: 2016 },
      { club: 'Paris Saint Germain', from: 2023, to: null },
    ],
  },
  {
    name: 'Mauricio Pochettino',
    spells: [
      { club: 'Tottenham', from: 2014, to: 2019 },
      { club: 'Paris Saint Germain', from: 2020, to: 2021 },
      { club: 'Chelsea', from: 2023, to: 2023 },
    ],
  },
  {
    name: 'Thomas Tuchel',
    spells: [
      { club: 'Borussia Dortmund', from: 2015, to: 2016 },
      { club: 'Paris Saint Germain', from: 2018, to: 2019 },
      { club: 'Chelsea', from: 2020, to: 2022 },
      { club: 'Bayern München', from: 2023, to: 2024 },
    ],
  },
  { name: 'Frank Rijkaard', spells: [{ club: 'Barcelona', from: 2003, to: 2007 }] },
  { name: 'Vicente del Bosque', spells: [{ club: 'Real Madrid', from: 1999, to: 2002 }] },
  {
    name: 'Roberto Mancini',
    spells: [
      { club: 'Inter', from: 2004, to: 2007 },
      { club: 'Manchester City', from: 2009, to: 2012 },
      { club: 'Inter', from: 2014, to: 2015 },
    ],
  },
  {
    name: 'Manuel Pellegrini',
    spells: [
      { club: 'Villarreal', from: 2004, to: 2008 },
      { club: 'Real Madrid', from: 2009, to: 2009 },
      { club: 'Malaga', from: 2010, to: 2012 },
      { club: 'Manchester City', from: 2013, to: 2015 },
      { club: 'West Ham', from: 2018, to: 2019 },
      { club: 'Real Betis', from: 2020, to: null },
    ],
  },
  {
    name: 'Unai Emery',
    spells: [
      { club: 'Valencia', from: 2008, to: 2011 },
      { club: 'Sevilla', from: 2013, to: 2015 },
      { club: 'Paris Saint Germain', from: 2016, to: 2017 },
      { club: 'Arsenal', from: 2018, to: 2019 },
      { club: 'Villarreal', from: 2020, to: 2021 },
      { club: 'Aston Villa', from: 2023, to: null },
    ],
  },
  { name: 'Xabi Alonso', spells: [{ club: 'Bayer Leverkusen', from: 2022, to: 2024 }] },
  { name: 'Xavi', spells: [{ club: 'Barcelona', from: 2021, to: 2023 }] },
  { name: 'Mikel Arteta', spells: [{ club: 'Arsenal', from: 2019, to: null }] },
  {
    name: 'Erik ten Hag',
    spells: [
      { club: 'Ajax', from: 2017, to: 2021 },
      { club: 'Manchester United', from: 2022, to: 2024 },
    ],
  },
  {
    name: 'Hansi Flick',
    spells: [
      { club: 'Bayern München', from: 2019, to: 2020 },
      { club: 'Barcelona', from: 2024, to: null },
    ],
  },
  {
    name: 'Julian Nagelsmann',
    spells: [
      { club: 'Hoffenheim', from: 2015, to: 2018 },
      { club: 'RB Leipzig', from: 2019, to: 2020 },
      { club: 'Bayern München', from: 2021, to: 2022 },
    ],
  },
  {
    name: 'Maurizio Sarri',
    spells: [
      { club: 'Napoli', from: 2015, to: 2017 },
      { club: 'Chelsea', from: 2018, to: 2018 },
      { club: 'Juventus', from: 2019, to: 2019 },
      { club: 'Lazio', from: 2021, to: 2023 },
    ],
  },
  {
    name: 'Claudio Ranieri',
    spells: [
      { club: 'Chelsea', from: 2000, to: 2003 },
      { club: 'Leicester', from: 2015, to: 2016 },
    ],
  },
  {
    name: 'Marcelo Bielsa',
    spells: [
      { club: 'Athletic Club', from: 2011, to: 2012 },
      { club: 'Leeds', from: 2018, to: 2021 },
    ],
  },
  {
    name: 'Jupp Heynckes',
    spells: [
      { club: 'Bayern München', from: 2011, to: 2012 },
      { club: 'Bayern München', from: 2017, to: 2017 },
    ],
  },
  {
    name: 'Ottmar Hitzfeld',
    spells: [
      { club: 'Borussia Dortmund', from: 1991, to: 1997 },
      { club: 'Bayern München', from: 1998, to: 2003 },
      { club: 'Bayern München', from: 2007, to: 2007 },
    ],
  },
  {
    name: 'Fabio Capello',
    spells: [
      { club: 'Real Madrid', from: 1996, to: 1996 },
      { club: 'Roma', from: 1999, to: 2003 },
      { club: 'Juventus', from: 2004, to: 2005 },
      { club: 'Real Madrid', from: 2006, to: 2006 },
    ],
  },

  // ---- Extended bank (2025). Same rules: season-start years, club spells only (national-team
  // jobs don't match players), clubs spelled as stored in player_stats (see canonical list /
  // CLUB_ALIASES). The QA pass below flags any club that doesn't resolve. ----
  {
    name: 'Ruben Amorim',
    spells: [
      { club: 'Sporting CP', from: 2020, to: 2024 },
      { club: 'Manchester United', from: 2024, to: null },
    ],
  },
  {
    name: 'Arne Slot',
    spells: [
      { club: 'Feyenoord', from: 2021, to: 2023 },
      { club: 'Liverpool', from: 2024, to: null },
    ],
  },
  {
    name: 'Enzo Maresca',
    spells: [
      { club: 'Leicester', from: 2023, to: 2023 },
      { club: 'Chelsea', from: 2024, to: null },
    ],
  },
  {
    name: 'Vincent Kompany',
    spells: [
      { club: 'Burnley', from: 2022, to: 2023 },
      { club: 'Bayern München', from: 2024, to: null },
    ],
  },
  {
    name: 'Eddie Howe',
    spells: [
      { club: 'Bournemouth', from: 2012, to: 2019 },
      { club: 'Newcastle', from: 2021, to: null },
    ],
  },
  {
    name: 'Ange Postecoglou',
    spells: [
      { club: 'Celtic', from: 2021, to: 2022 },
      { club: 'Tottenham', from: 2023, to: 2024 },
    ],
  },
  {
    name: 'Oliver Glasner',
    spells: [
      { club: 'VfL Wolfsburg', from: 2019, to: 2020 },
      { club: 'Eintracht Frankfurt', from: 2021, to: 2022 },
      { club: 'Crystal Palace', from: 2023, to: null },
    ],
  },
  {
    name: 'Thomas Frank',
    spells: [
      { club: 'Brentford', from: 2018, to: 2024 },
      { club: 'Tottenham', from: 2025, to: null },
    ],
  },
  {
    name: 'David Moyes',
    spells: [
      { club: 'Everton', from: 2002, to: 2012 },
      { club: 'Manchester United', from: 2013, to: 2013 },
      { club: 'Sunderland', from: 2016, to: 2016 },
      { club: 'West Ham', from: 2017, to: 2017 },
      { club: 'West Ham', from: 2019, to: 2023 },
      { club: 'Everton', from: 2024, to: null },
    ],
  },
  {
    name: 'Harry Redknapp',
    spells: [
      { club: 'West Ham', from: 1994, to: 2000 },
      { club: 'Portsmouth', from: 2002, to: 2003 },
      { club: 'Portsmouth', from: 2005, to: 2007 },
      { club: 'Tottenham', from: 2008, to: 2011 },
      { club: 'QPR', from: 2012, to: 2014 },
    ],
  },
  {
    name: 'Roy Hodgson',
    spells: [
      { club: 'Inter', from: 1995, to: 1996 },
      { club: 'Fulham', from: 2007, to: 2009 },
      { club: 'Liverpool', from: 2010, to: 2010 },
      { club: 'West Brom', from: 2011, to: 2011 },
      { club: 'Crystal Palace', from: 2017, to: 2020 },
      { club: 'Crystal Palace', from: 2022, to: 2023 },
    ],
  },
  {
    name: 'Kenny Dalglish',
    spells: [
      { club: 'Blackburn', from: 1992, to: 1994 },
      { club: 'Newcastle', from: 1997, to: 1997 },
      { club: 'Liverpool', from: 2010, to: 2011 },
    ],
  },
  {
    name: 'Brendan Rodgers',
    spells: [
      { club: 'Swansea', from: 2010, to: 2011 },
      { club: 'Liverpool', from: 2012, to: 2015 },
      { club: 'Celtic', from: 2016, to: 2018 },
      { club: 'Leicester', from: 2019, to: 2022 },
      { club: 'Celtic', from: 2023, to: null },
    ],
  },
  {
    name: 'Graham Potter',
    spells: [
      { club: 'Brighton', from: 2019, to: 2021 },
      { club: 'Chelsea', from: 2022, to: 2022 },
      { club: 'West Ham', from: 2024, to: 2025 },
    ],
  },
  {
    name: 'Sean Dyche',
    spells: [
      { club: 'Burnley', from: 2012, to: 2021 },
      { club: 'Everton', from: 2022, to: 2024 },
    ],
  },
  {
    name: 'Nuno Espírito Santo',
    spells: [
      { club: 'Valencia', from: 2014, to: 2015 },
      { club: 'Wolves', from: 2017, to: 2020 },
      { club: 'Tottenham', from: 2021, to: 2021 },
      { club: 'Nottingham Forest', from: 2023, to: 2025 },
    ],
  },
  {
    name: 'Marco Silva',
    spells: [
      { club: 'Hull City', from: 2016, to: 2016 },
      { club: 'Watford', from: 2017, to: 2017 },
      { club: 'Everton', from: 2018, to: 2019 },
      { club: 'Fulham', from: 2021, to: null },
    ],
  },
  {
    name: 'Roberto De Zerbi',
    spells: [
      { club: 'Sassuolo', from: 2018, to: 2020 },
      { club: 'Brighton', from: 2022, to: 2023 },
      { club: 'Marseille', from: 2024, to: null },
    ],
  },
  {
    name: 'Gian Piero Gasperini',
    spells: [
      { club: 'Genoa', from: 2006, to: 2009 },
      { club: 'Inter', from: 2011, to: 2011 },
      { club: 'Genoa', from: 2013, to: 2015 },
      { club: 'Atalanta', from: 2016, to: 2024 },
      { club: 'Roma', from: 2025, to: null },
    ],
  },
  {
    name: 'Stefano Pioli',
    spells: [
      { club: 'Lazio', from: 2014, to: 2015 },
      { club: 'Inter', from: 2016, to: 2016 },
      { club: 'Fiorentina', from: 2017, to: 2018 },
      { club: 'AC Milan', from: 2019, to: 2023 },
      { club: 'Fiorentina', from: 2025, to: null },
    ],
  },
  {
    name: 'Simone Inzaghi',
    spells: [
      { club: 'Lazio', from: 2016, to: 2020 },
      { club: 'Inter', from: 2021, to: 2024 },
    ],
  },
  {
    name: 'Luciano Spalletti',
    spells: [
      { club: 'Udinese', from: 2002, to: 2004 },
      { club: 'Roma', from: 2005, to: 2008 },
      { club: 'Roma', from: 2015, to: 2016 },
      { club: 'Inter', from: 2017, to: 2018 },
      { club: 'Napoli', from: 2021, to: 2022 },
    ],
  },
  {
    name: 'Gennaro Gattuso',
    spells: [
      { club: 'AC Milan', from: 2017, to: 2018 },
      { club: 'Napoli', from: 2019, to: 2020 },
      { club: 'Valencia', from: 2022, to: 2022 },
      { club: 'Marseille', from: 2023, to: 2023 },
    ],
  },
  { name: 'Andrea Pirlo', spells: [{ club: 'Juventus', from: 2020, to: 2020 }] },
  {
    name: 'Thiago Motta',
    spells: [
      { club: 'Bologna', from: 2022, to: 2023 },
      { club: 'Juventus', from: 2024, to: 2024 },
    ],
  },
  {
    name: 'Vincenzo Italiano',
    spells: [
      { club: 'Fiorentina', from: 2021, to: 2023 },
      { club: 'Bologna', from: 2024, to: null },
    ],
  },
  {
    name: 'Marcello Lippi',
    spells: [
      { club: 'Napoli', from: 1993, to: 1993 },
      { club: 'Juventus', from: 1994, to: 1998 },
      { club: 'Inter', from: 1999, to: 1999 },
      { club: 'Juventus', from: 2001, to: 2003 },
    ],
  },
  {
    name: 'Giovanni Trapattoni',
    spells: [
      { club: 'Juventus', from: 1991, to: 1993 },
      { club: 'Bayern München', from: 1994, to: 1994 },
      { club: 'Bayern München', from: 1996, to: 1997 },
      { club: 'Fiorentina', from: 1998, to: 1999 },
    ],
  },
  {
    name: 'Sven-Göran Eriksson',
    spells: [
      { club: 'Sampdoria', from: 1992, to: 1996 },
      { club: 'Lazio', from: 1997, to: 2000 },
      { club: 'Manchester City', from: 2007, to: 2007 },
    ],
  },
  { name: 'Roberto Di Matteo', spells: [{ club: 'Chelsea', from: 2011, to: 2012 }] },
  {
    name: 'Guus Hiddink',
    spells: [
      { club: 'Real Madrid', from: 1998, to: 1998 },
      { club: 'PSV Eindhoven', from: 2002, to: 2005 },
      { club: 'Chelsea', from: 2008, to: 2008 },
      { club: 'Chelsea', from: 2015, to: 2015 },
    ],
  },
  {
    name: 'Ernesto Valverde',
    spells: [
      { club: 'Athletic Club', from: 2013, to: 2016 },
      { club: 'Barcelona', from: 2017, to: 2019 },
      { club: 'Athletic Club', from: 2022, to: null },
    ],
  },
  {
    name: 'Ronald Koeman',
    spells: [
      { club: 'Ajax', from: 2001, to: 2004 },
      { club: 'Valencia', from: 2007, to: 2007 },
      { club: 'Southampton', from: 2014, to: 2015 },
      { club: 'Everton', from: 2016, to: 2017 },
      { club: 'Barcelona', from: 2020, to: 2021 },
    ],
  },
  {
    name: 'Julen Lopetegui',
    spells: [
      { club: 'Porto', from: 2014, to: 2015 },
      { club: 'Real Madrid', from: 2018, to: 2018 },
      { club: 'Sevilla', from: 2019, to: 2021 },
      { club: 'Wolves', from: 2022, to: 2022 },
      { club: 'West Ham', from: 2024, to: 2024 },
    ],
  },
  { name: 'Míchel', spells: [{ club: 'Girona', from: 2021, to: null }] },
  { name: 'Imanol Alguacil', spells: [{ club: 'Real Sociedad', from: 2018, to: 2024 }] },
  {
    name: 'Marcelino',
    spells: [
      { club: 'Villarreal', from: 2013, to: 2015 },
      { club: 'Valencia', from: 2017, to: 2018 },
      { club: 'Athletic Club', from: 2020, to: 2021 },
      { club: 'Villarreal', from: 2024, to: null },
    ],
  },
  { name: 'José Luis Mendilibar', spells: [{ club: 'Eibar', from: 2015, to: 2020 }, { club: 'Sevilla', from: 2022, to: 2023 }] },
  { name: 'Andoni Iraola', spells: [{ club: 'Rayo Vallecano', from: 2020, to: 2022 }, { club: 'Bournemouth', from: 2023, to: null }] },
  { name: 'José Bordalás', spells: [{ club: 'Getafe', from: 2016, to: 2020 }, { club: 'Valencia', from: 2021, to: 2021 }, { club: 'Getafe', from: 2023, to: null }] },
  {
    name: 'Niko Kovač',
    spells: [
      { club: 'Eintracht Frankfurt', from: 2016, to: 2017 },
      { club: 'Bayern München', from: 2018, to: 2019 },
      { club: 'VfL Wolfsburg', from: 2022, to: 2023 },
      { club: 'Borussia Dortmund', from: 2024, to: null },
    ],
  },
  { name: 'Edin Terzić', spells: [{ club: 'Borussia Dortmund', from: 2020, to: 2020 }, { club: 'Borussia Dortmund', from: 2022, to: 2023 }] },
  {
    name: 'Adi Hütter',
    spells: [
      { club: 'Eintracht Frankfurt', from: 2018, to: 2020 },
      { club: 'Borussia Mönchengladbach', from: 2021, to: 2021 },
      { club: 'Monaco', from: 2023, to: null },
    ],
  },
  { name: 'Christian Streich', spells: [{ club: 'SC Freiburg', from: 2011, to: 2023 }] },
  { name: 'Sebastian Hoeneß', spells: [{ club: 'VfB Stuttgart', from: 2023, to: null }] },
  {
    name: 'Felix Magath',
    spells: [
      { club: 'VfB Stuttgart', from: 2001, to: 2003 },
      { club: 'Bayern München', from: 2004, to: 2006 },
      { club: 'VfL Wolfsburg', from: 2007, to: 2008 },
      { club: 'FC Schalke 04', from: 2009, to: 2010 },
      { club: 'Fulham', from: 2013, to: 2013 },
    ],
  },
  {
    name: 'Lucien Favre',
    spells: [
      { club: 'Borussia Mönchengladbach', from: 2011, to: 2014 },
      { club: 'Nice', from: 2016, to: 2017 },
      { club: 'Borussia Dortmund', from: 2018, to: 2020 },
    ],
  },
  {
    name: 'Marco Rose',
    spells: [
      { club: 'Borussia Mönchengladbach', from: 2019, to: 2020 },
      { club: 'Borussia Dortmund', from: 2021, to: 2021 },
      { club: 'RB Leipzig', from: 2022, to: 2024 },
    ],
  },
  {
    name: 'Ralf Rangnick',
    spells: [
      { club: 'FC Schalke 04', from: 2004, to: 2005 },
      { club: 'Hoffenheim', from: 2008, to: 2010 },
      { club: 'FC Schalke 04', from: 2011, to: 2011 },
      { club: 'RB Leipzig', from: 2015, to: 2015 },
      { club: 'RB Leipzig', from: 2018, to: 2018 },
      { club: 'Manchester United', from: 2021, to: 2021 },
    ],
  },
  {
    name: 'Ralph Hasenhüttl',
    spells: [
      { club: 'RB Leipzig', from: 2016, to: 2017 },
      { club: 'Southampton', from: 2018, to: 2021 },
      { club: 'VfL Wolfsburg', from: 2024, to: null },
    ],
  },
  { name: 'Jesse Marsch', spells: [{ club: 'RB Leipzig', from: 2021, to: 2021 }, { club: 'Leeds', from: 2021, to: 2022 }] },
  { name: 'Daniel Farke', spells: [{ club: 'Norwich', from: 2017, to: 2021 }, { club: 'Borussia Mönchengladbach', from: 2022, to: 2022 }, { club: 'Leeds', from: 2023, to: null }] },
  { name: 'Fabian Hürzeler', spells: [{ club: 'Brighton', from: 2024, to: null }] },
  { name: 'Cesc Fàbregas', spells: [{ club: 'Como', from: 2023, to: null }] },
  {
    name: 'Igor Tudor',
    spells: [
      { club: 'Hellas Verona', from: 2021, to: 2021 },
      { club: 'Marseille', from: 2022, to: 2022 },
      { club: 'Lazio', from: 2023, to: 2023 },
      { club: 'Juventus', from: 2024, to: null },
    ],
  },
  {
    name: 'Ivan Jurić',
    spells: [
      { club: 'Genoa', from: 2016, to: 2018 },
      { club: 'Hellas Verona', from: 2019, to: 2020 },
      { club: 'Torino', from: 2021, to: 2023 },
      { club: 'Roma', from: 2024, to: 2024 },
      { club: 'Atalanta', from: 2025, to: null },
    ],
  },
  {
    name: 'Walter Mazzarri',
    spells: [
      { club: 'Napoli', from: 2009, to: 2012 },
      { club: 'Inter', from: 2013, to: 2014 },
      { club: 'Watford', from: 2016, to: 2016 },
      { club: 'Torino', from: 2018, to: 2019 },
      { club: 'Napoli', from: 2023, to: 2023 },
    ],
  },
  { name: 'Eusebio Di Francesco', spells: [{ club: 'Sassuolo', from: 2012, to: 2016 }, { club: 'Roma', from: 2017, to: 2018 }] },
  {
    name: 'Siniša Mihajlović',
    spells: [
      { club: 'Fiorentina', from: 2010, to: 2011 },
      { club: 'Sampdoria', from: 2013, to: 2014 },
      { club: 'AC Milan', from: 2015, to: 2015 },
      { club: 'Torino', from: 2016, to: 2017 },
      { club: 'Bologna', from: 2019, to: 2021 },
    ],
  },
  { name: 'Bruno Lage', spells: [{ club: 'Benfica', from: 2019, to: 2020 }, { club: 'Wolves', from: 2021, to: 2022 }, { club: 'Benfica', from: 2024, to: null }] },
  {
    name: 'Sérgio Conceição',
    spells: [
      { club: 'Nantes', from: 2016, to: 2016 },
      { club: 'Porto', from: 2017, to: 2023 },
      { club: 'AC Milan', from: 2024, to: 2024 },
    ],
  },
  {
    name: 'Paulo Fonseca',
    spells: [
      { club: 'Porto', from: 2013, to: 2013 },
      { club: 'Roma', from: 2019, to: 2020 },
      { club: 'Lille', from: 2022, to: 2023 },
      { club: 'AC Milan', from: 2024, to: 2024 },
      { club: 'Lyon', from: 2025, to: null },
    ],
  },
  { name: 'Jorge Jesus', spells: [{ club: 'Benfica', from: 2009, to: 2014 }, { club: 'Sporting CP', from: 2015, to: 2017 }, { club: 'Benfica', from: 2020, to: 2021 }] },
  {
    name: 'Peter Bosz',
    spells: [
      { club: 'Ajax', from: 2016, to: 2016 },
      { club: 'Borussia Dortmund', from: 2017, to: 2017 },
      { club: 'Bayer Leverkusen', from: 2018, to: 2020 },
      { club: 'Lyon', from: 2021, to: 2022 },
      { club: 'PSV Eindhoven', from: 2023, to: null },
    ],
  },
  { name: 'Frank de Boer', spells: [{ club: 'Ajax', from: 2010, to: 2015 }, { club: 'Inter', from: 2016, to: 2016 }, { club: 'Crystal Palace', from: 2017, to: 2017 }] },
  {
    name: 'Christophe Galtier',
    spells: [
      { club: 'Saint-Étienne', from: 2009, to: 2016 },
      { club: 'Lille', from: 2017, to: 2020 },
      { club: 'Nice', from: 2021, to: 2021 },
      { club: 'Paris Saint Germain', from: 2022, to: 2022 },
    ],
  },
  {
    name: 'Rudi Garcia',
    spells: [
      { club: 'Lille', from: 2008, to: 2012 },
      { club: 'Roma', from: 2013, to: 2015 },
      { club: 'Marseille', from: 2016, to: 2018 },
      { club: 'Lyon', from: 2019, to: 2020 },
      { club: 'Napoli', from: 2023, to: 2023 },
    ],
  },
  {
    name: 'Laurent Blanc',
    spells: [
      { club: 'Bordeaux', from: 2007, to: 2009 },
      { club: 'Paris Saint Germain', from: 2013, to: 2015 },
      { club: 'Lyon', from: 2022, to: 2023 },
    ],
  },
  { name: 'Leonardo Jardim', spells: [{ club: 'Sporting CP', from: 2013, to: 2013 }, { club: 'Monaco', from: 2014, to: 2018 }] },
  {
    name: 'Didier Deschamps',
    spells: [
      { club: 'Monaco', from: 2001, to: 2004 },
      { club: 'Juventus', from: 2006, to: 2006 },
      { club: 'Marseille', from: 2009, to: 2011 },
    ],
  },
  { name: 'Franck Haise', spells: [{ club: 'Lens', from: 2020, to: 2023 }, { club: 'Nice', from: 2024, to: null }] },
  {
    name: 'Ole Gunnar Solskjær',
    spells: [{ club: 'Manchester United', from: 2018, to: 2021 }],
  },
  { name: 'Roberto Martínez', spells: [{ club: 'Wigan Athletic', from: 2009, to: 2012 }, { club: 'Everton', from: 2013, to: 2015 }] },
  {
    name: 'André Villas-Boas',
    spells: [
      { club: 'Porto', from: 2010, to: 2010 },
      { club: 'Chelsea', from: 2011, to: 2011 },
      { club: 'Tottenham', from: 2012, to: 2013 },
      { club: 'Marseille', from: 2019, to: 2020 },
    ],
  },
  {
    name: 'Mark Hughes',
    spells: [
      { club: 'Blackburn', from: 2004, to: 2007 },
      { club: 'Manchester City', from: 2008, to: 2009 },
      { club: 'Stoke City', from: 2013, to: 2017 },
      { club: 'Southampton', from: 2018, to: 2018 },
    ],
  },
  { name: 'Tony Pulis', spells: [{ club: 'Stoke City', from: 2008, to: 2012 }, { club: 'Crystal Palace', from: 2013, to: 2013 }, { club: 'West Brom', from: 2015, to: 2017 }] },
  { name: 'Alan Pardew', spells: [{ club: 'West Ham', from: 2003, to: 2005 }, { club: 'Newcastle', from: 2010, to: 2014 }, { club: 'Crystal Palace', from: 2015, to: 2016 }] },
  { name: 'Slaven Bilić', spells: [{ club: 'West Ham', from: 2015, to: 2017 }, { club: 'West Brom', from: 2019, to: 2020 }] },
  { name: 'Sam Allardyce', spells: [{ club: 'Bolton', from: 1999, to: 2006 }, { club: 'Newcastle', from: 2007, to: 2007 }, { club: 'West Ham', from: 2011, to: 2014 }, { club: 'Sunderland', from: 2015, to: 2015 }, { club: 'Everton', from: 2017, to: 2017 }] },
  { name: 'Frank Lampard', spells: [{ club: 'Chelsea', from: 2019, to: 2020 }, { club: 'Everton', from: 2021, to: 2022 }] },
  { name: 'Steven Gerrard', spells: [{ club: 'Rangers', from: 2018, to: 2021 }, { club: 'Aston Villa', from: 2021, to: 2022 }] },
  { name: 'Patrick Vieira', spells: [{ club: 'Nice', from: 2018, to: 2020 }, { club: 'Crystal Palace', from: 2021, to: 2022 }] },
  { name: 'Michael Laudrup', spells: [{ club: 'Getafe', from: 2007, to: 2007 }, { club: 'Swansea', from: 2012, to: 2013 }] },
  { name: 'Juande Ramos', spells: [{ club: 'Sevilla', from: 2005, to: 2006 }, { club: 'Tottenham', from: 2007, to: 2008 }, { club: 'Real Madrid', from: 2008, to: 2008 }] },
  { name: 'Luiz Felipe Scolari', spells: [{ club: 'Chelsea', from: 2008, to: 2008 }] },
  { name: 'Kevin Keegan', spells: [{ club: 'Newcastle', from: 1992, to: 1996 }, { club: 'Manchester City', from: 2001, to: 2004 }, { club: 'Newcastle', from: 2008, to: 2008 }] },
  { name: 'Sir Bobby Robson', spells: [{ club: 'Porto', from: 1994, to: 1995 }, { club: 'Barcelona', from: 1996, to: 1996 }, { club: 'PSV Eindhoven', from: 1998, to: 1998 }, { club: 'Newcastle', from: 1999, to: 2003 }] },
  { name: 'Glenn Hoddle', spells: [{ club: 'Chelsea', from: 1993, to: 1995 }, { club: 'Southampton', from: 2000, to: 2000 }, { club: 'Tottenham', from: 2001, to: 2002 }] },
  { name: 'Ruud Gullit', spells: [{ club: 'Chelsea', from: 1996, to: 1997 }, { club: 'Newcastle', from: 1998, to: 1998 }] },
  { name: 'Gianluca Vialli', spells: [{ club: 'Chelsea', from: 1998, to: 1999 }] },
  { name: 'Gerard Houllier', spells: [{ club: 'Liverpool', from: 1998, to: 2003 }, { club: 'Lyon', from: 2005, to: 2006 }, { club: 'Aston Villa', from: 2010, to: 2010 }] },
  { name: 'Martin O\'Neill', spells: [{ club: 'Leicester', from: 1995, to: 1999 }, { club: 'Celtic', from: 2000, to: 2004 }, { club: 'Aston Villa', from: 2006, to: 2009 }, { club: 'Sunderland', from: 2011, to: 2012 }] },
  { name: 'Quique Setién', spells: [{ club: 'Real Betis', from: 2017, to: 2018 }, { club: 'Barcelona', from: 2019, to: 2019 }, { club: 'Villarreal', from: 2022, to: 2023 }] },
];

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS manager_tenures (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      manager text NOT NULL,
      manager_norm text NOT NULL,
      club text NOT NULL,
      club_norm text NOT NULL,
      season_from integer NOT NULL,
      season_to integer,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS manager_tenures_unique ON manager_tenures (manager_norm, club_norm, season_from)`
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS manager_tenures_manager_idx ON manager_tenures (manager_norm)`
  );

  // Fully curated → clean rebuild each run so edits (renamed clubs, fixed dates) don't
  // leave stale rows behind.
  await db.execute(sql`DELETE FROM manager_tenures`);

  let rows = 0;
  for (const m of MANAGERS) {
    const managerNorm = normClub(m.name);
    for (const sp of m.spells) {
      await db.execute(sql`
        INSERT INTO manager_tenures (manager, manager_norm, club, club_norm, season_from, season_to)
        VALUES (${m.name}, ${managerNorm}, ${sp.club}, ${normClub(sp.club)}, ${sp.from}, ${sp.to})
        ON CONFLICT (manager_norm, club_norm, season_from) DO UPDATE SET season_to = EXCLUDED.season_to
      `);
      rows += 1;
    }
  }
  console.log(`Seeded ${MANAGERS.length} managers · ${rows} tenures.`);

  // --- QA: which curated clubs didn't match any stored team_name? ---
  const unmatched = await unmatchedTenureClubs();
  if (unmatched.length) {
    console.log(`\n⚠️  Unmatched clubs (need alias): ${unmatched.join(', ')}`);
  } else {
    console.log('\nAll curated clubs matched stored team names.');
  }

  // --- Verify end-to-end with marquee crossovers ---
  const checks: Array<[string, string[]]> = [
    ['Mourinho + Guardiola', ['jose mourinho', 'pep guardiola']],
    ['Ancelotti + Guardiola', ['carlo ancelotti', 'pep guardiola']],
    ['Ferguson + Mourinho', ['sir alex ferguson', 'jose mourinho']],
    ['Klopp + Guardiola', ['jurgen klopp', 'pep guardiola']],
  ];
  for (const [label, norms] of checks) {
    const ids = await playersUnderAll(norms);
    let sample: string[] = [];
    if (ids.size) {
      const rows2 = (await db.execute(sql`
        SELECT name FROM players WHERE id IN (${sql.join([...ids].map((i) => sql`${i}::uuid`), sql`, `)})
        ORDER BY name LIMIT 12
      `)) as unknown as Array<{ name: string }>;
      sample = rows2.map((r) => r.name);
    }
    console.log(`\n${label}: ${ids.size} players`);
    if (sample.length) console.log(`  e.g. ${sample.join(', ')}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
