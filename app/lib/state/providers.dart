import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../models/bracket.dart';
import '../models/delivery.dart';
import '../models/fixture.dart';
import '../models/live_match.dart';
import '../models/match_detail.dart';
import '../models/pagination.dart';
import '../models/platform.dart';
import '../models/player.dart';
import '../models/standing.dart';
import '../models/team.dart';
import '../models/tournament.dart';
import '../models/tournament_awards.dart';
import '../services/pending_delivery_queue.dart';

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient());

final pendingDeliveryQueueProvider = Provider<PendingDeliveryQueue>((ref) => PendingDeliveryQueue());

final tournamentsProvider = FutureProvider<Paginated<Tournament>>((ref) {
  return ref.watch(apiClientProvider).getTournaments();
});

final tournamentProvider = FutureProvider.family<Tournament, String>((ref, slug) {
  return ref.watch(apiClientProvider).getTournament(slug);
});

final platformSettingsProvider = FutureProvider<PlatformSettings>((ref) {
  return ref.watch(apiClientProvider).getPlatformSettings();
});

final pendingTournamentsProvider = FutureProvider<List<PendingTournament>>((ref) {
  return ref.watch(apiClientProvider).getPendingTournaments();
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

final knockoutBracketProvider = FutureProvider.family<KnockoutBracket, String>((ref, slug) {
  return ref.watch(apiClientProvider).getKnockoutBracket(slug);
});

final awardsProvider = FutureProvider.family<TournamentAwards, String>((ref, slug) {
  return ref.watch(apiClientProvider).getTournamentAwards(slug);
});

typedef SquadKey = ({String teamId, String tournamentSlug});

final squadProvider = FutureProvider.family<List<SquadPlayer>, SquadKey>((ref, key) {
  return ref.watch(apiClientProvider).getSquad(key.teamId, key.tournamentSlug);
});

/// Same shape as [squadProvider] but includes pending (not-yet-approved)
/// entries — only the tournament's organiser or that team's own manager
/// can actually load this without a 403.
final managedSquadProvider = FutureProvider.family<List<SquadPlayer>, SquadKey>((ref, key) {
  return ref.watch(apiClientProvider).getManagedSquad(key.tournamentSlug, key.teamId);
});

final teamManagersProvider = FutureProvider.family<List<TeamManager>, SquadKey>((ref, key) {
  return ref.watch(apiClientProvider).getTeamManagers(key.tournamentSlug, key.teamId);
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
