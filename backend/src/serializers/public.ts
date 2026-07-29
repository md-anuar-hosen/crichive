/**
 * Every public route must go through these. suomisport_id, date_of_birth,
 * phone, and email must never reach a public response — see CLAUDE.md.
 */

interface PublicPlayerRow {
  id: string;
  full_name: string;
  display_name: string | null;
  batting: string | null;
  bowling: string | null;
  photo_url: string | null;
}

export function serializePlayer(player: PublicPlayerRow) {
  return {
    id: player.id,
    name: player.display_name ?? player.full_name,
    batting: player.batting,
    bowling: player.bowling,
    photo_url: player.photo_url,
  };
}

interface PublicTeamRow {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  home_city: string | null;
}

export function serializeTeam(team: PublicTeamRow) {
  return {
    id: team.id,
    name: team.name,
    short_name: team.short_name,
    logo_url: team.logo_url,
    home_city: team.home_city,
  };
}

interface PublicTournamentRow {
  id: string;
  name: string;
  season_year: number;
  slug: string;
  organizer_org: string | null;
  country_code: string;
  ball: string;
  starts_on: Date | null;
  ends_on: Date | null;
  logo_url: string | null;
  approved_at?: Date | null;
}

export function serializeTournament(t: PublicTournamentRow) {
  return {
    id: t.id,
    name: t.name,
    season_year: t.season_year,
    slug: t.slug,
    organizer_org: t.organizer_org,
    country_code: t.country_code,
    ball: t.ball,
    starts_on: t.starts_on,
    ends_on: t.ends_on,
    logo_url: t.logo_url,
    is_approved: t.approved_at !== undefined ? t.approved_at !== null : true,
  };
}

interface PublicGroundRow {
  id: string;
  name: string;
  city: string | null;
}

export function serializeGround(g: PublicGroundRow) {
  return { id: g.id, name: g.name, city: g.city };
}
