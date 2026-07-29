import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../models/delivery.dart';
import '../models/fixture.dart';
import '../models/live_match.dart';
import '../models/match_detail.dart';
import '../models/pagination.dart';
import '../models/player.dart';
import '../models/standing.dart';
import '../models/team.dart';
import '../models/tournament.dart';
import '../models/tournament_awards.dart';

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient());

final tournamentsProvider = FutureProvider<Paginated<Tournament>>((ref) {
  return ref.watch(apiClientProvider).getTournaments();
});

final tournamentProvider = FutureProvider.family<Tournament, String>((ref, slug) {
  return ref.watch(apiClientProvider).getTournament(slug);
});

final teamsProvider = FutureProvider.family<Paginated<Team>, String>((ref, slug) {
  return ref.watch(apiClientProvider).getTeams(slug);
});

final fixturesProvider = FutureProvider.family<Paginated<Fixture>, String>((ref, slug) {
  return ref.watch(apiClientProvider).getFixtures(slug);
});

final standingsProvider = FutureProvider.family<List<StandingGroup>, String>((ref, slug) {
  return ref.watch(apiClientProvider).getStandings(slug);
});

final awardsProvider = FutureProvider.family<TournamentAwards, String>((ref, slug) {
  return ref.watch(apiClientProvider).getTournamentAwards(slug);
});

typedef SquadKey = ({String teamId, String tournamentSlug});

final squadProvider = FutureProvider.family<List<SquadPlayer>, SquadKey>((ref, key) {
  return ref.watch(apiClientProvider).getSquad(key.teamId, key.tournamentSlug);
});

final playerProvider = FutureProvider.family<PlayerDetail, String>((ref, id) {
  return ref.watch(apiClientProvider).getPlayer(id);
});

final liveMatchesProvider = FutureProvider<List<LiveMatch>>((ref) {
  return ref.watch(apiClientProvider).getLiveMatches();
});

final matchProvider = FutureProvider.family<MatchDetail, String>((ref, id) {
  return ref.watch(apiClientProvider).getMatch(id);
});

typedef DeliveriesKey = ({String matchId, int inningsNumber});

final deliveriesProvider = FutureProvider.family<List<Delivery>, DeliveriesKey>((ref, key) {
  return ref.watch(apiClientProvider).getDeliveries(key.matchId, key.inningsNumber);
});
