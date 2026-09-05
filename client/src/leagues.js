// Country each covered league is based in, keyed by canonical league name.
// [full name, FIFA-style code]
const LEAGUE_COUNTRIES = {
  'Premier League': ['England', 'ENG'],
  'Championship': ['England', 'ENG'],
  'League One': ['England', 'ENG'],
  'La Liga': ['Spain', 'ESP'],
  'Serie A': ['Italy', 'ITA'],
  'Bundesliga': ['Germany', 'GER'],
  'Ligue 1': ['France', 'FRA'],
  'Liga MX': ['Mexico', 'MEX'],
  'Eredivisie': ['Netherlands', 'NED'],
  'Scottish Premiership': ['Scotland', 'SCO'],
  'Primeira Liga': ['Portugal', 'POR'],
  'Belgian Pro League': ['Belgium', 'BEL'],
  'Süper Lig': ['Turkey', 'TUR'],
  'Brasileirão': ['Brazil', 'BRA'],
  'Liga Profesional (Argentina)': ['Argentina', 'ARG'],
  'Austrian Bundesliga': ['Austria', 'AUT'],
};

export function leagueCountry(league) {
  return LEAGUE_COUNTRIES[league]?.[0] || null;
}

export function leagueCountryCode(league) {
  return LEAGUE_COUNTRIES[league]?.[1] || null;
}
