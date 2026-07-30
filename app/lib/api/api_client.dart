import 'package:dio/dio.dart';

import '../models/bracket.dart';
import '../models/data_request.dart';
import '../models/delivery.dart';
import '../models/delivery_result.dart';
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
import '../models/user.dart';
import 'api_exception.dart';

const _defaultBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:3000',
);

/// Wraps every backend route the app needs. [setTokenProvider] wires in the
/// current JWT (if any) via an interceptor; scoring routes 403 server-side
/// for users without the right tournament role.
class ApiClient {
  ApiClient({String? baseUrl})
    : _dio = Dio(BaseOptions(baseUrl: baseUrl ?? _defaultBaseUrl)) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final token = _tokenProvider?.call();
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) {
          handler.reject(_toApiError(error));
        },
      ),
    );
  }

  final Dio _dio;
  String? Function()? _tokenProvider;
  void Function()? onUnauthorized;

  void setTokenProvider(String? Function()? provider) =>
      _tokenProvider = provider;

  DioException _toApiError(DioException error) {
    final response = error.response;
    if (response?.statusCode == 401) {
      onUnauthorized?.call();
    }
    final data = response?.data;
    String message = error.message ?? 'Network error';
    List<Map<String, String>>? fieldErrors;
    if (data is Map<String, dynamic>) {
      message = (data['error'] as String?) ?? message;
      final fields = data['fields'];
      if (fields is List) {
        fieldErrors = fields
            .cast<Map<String, dynamic>>()
            .map(
              (f) => {
                'field': f['field'] as String,
                'message': f['message'] as String,
              },
            )
            .toList();
      }
    }
    return error.copyWith(
      error: ApiException(
        response?.statusCode,
        message,
        fieldErrors: fieldErrors,
      ),
    );
  }

  // ---------------------------------------------------------------------
  // Auth routes
  // ---------------------------------------------------------------------

  Future<User> register({
    required String email,
    required String password,
    required String displayName,
  }) async {
    final res = await _dio.post(
      '/auth/register',
      data: {'email': email, 'password': password, 'display_name': displayName},
    );
    return User.fromJson(
      (res.data as Map<String, dynamic>)['user'] as Map<String, dynamic>,
    );
  }

  Future<String> login({
    required String email,
    required String password,
  }) async {
    final res = await _dio.post(
      '/auth/login',
      data: {'email': email, 'password': password},
    );
    return (res.data as Map<String, dynamic>)['token'] as String;
  }

  Future<User> me() async {
    final res = await _dio.get('/auth/me');
    return User.fromJson(
      (res.data as Map<String, dynamic>)['user'] as Map<String, dynamic>,
    );
  }

  // ---------------------------------------------------------------------
  // Scoring routes (organizer/scorer only -- enforced server-side; a 403
  // here means this user lacks the tournament role, not a client bug)
  // ---------------------------------------------------------------------

  /// Organiser-only. The only way a match gets created outside the knockout
  /// bracket generator — covers a single one-off fixture just as well as a
  /// small round-robin scheduled one match at a time.
  Future<String> createMatch(
    String tournamentSlug, {
    required String teamAId,
    required String teamBId,
    DateTime? scheduledStart,
  }) async {
    final res = await _dio.post(
      '/tournaments/$tournamentSlug/matches',
      data: {
        'team_a_id': teamAId,
        'team_b_id': teamBId,
        'scheduled_start': ?scheduledStart?.toUtc().toIso8601String(),
      },
    );
    return (res.data as Map<String, dynamic>)['match_id'] as String;
  }

  Future<void> recordToss(
    String matchId, {
    required String winnerTeamId,
    required String decision,
  }) async {
    await _dio.post(
      '/matches/$matchId/toss',
      data: {'winner_team_id': winnerTeamId, 'decision': decision},
    );
  }

  Future<void> setPlayingXi(
    String matchId, {
    required String teamId,
    required List<String> playerIds,
    required String captainId,
    required String keeperId,
  }) async {
    await _dio.post(
      '/matches/$matchId/playing-xi',
      data: {
        'team_id': teamId,
        'player_ids': playerIds,
        'captain_id': captainId,
        'keeper_id': keeperId,
      },
    );
  }

  Future<DeliveryResult> postDelivery(
    String matchId, {
    required String clientEventId,
    required int inningsNumber,
    required String strikerId,
    required String nonStrikerId,
    required String bowlerId,
    int runsOffBat = 0,
    int extraWides = 0,
    int extraNoballs = 0,
    int extraByes = 0,
    int extraLegbyes = 0,
    int extraPenalty = 0,
    String? wicketKind,
    String? playerOutId,
    String? fielderId,
    String? commentary,
  }) async {
    final res = await _dio.post(
      '/matches/$matchId/deliveries',
      data: {
        'client_event_id': clientEventId,
        'innings_number': inningsNumber,
        'striker_id': strikerId,
        'non_striker_id': nonStrikerId,
        'bowler_id': bowlerId,
        'runs_off_bat': runsOffBat,
        'extra_wides': extraWides,
        'extra_noballs': extraNoballs,
        'extra_byes': extraByes,
        'extra_legbyes': extraLegbyes,
        'extra_penalty': extraPenalty,
        'wicket_kind': ?wicketKind,
        'player_out_id': ?playerOutId,
        'fielder_id': ?fielderId,
        'commentary': ?commentary,
      },
    );
    return DeliveryResult.fromJson(res.data as Map<String, dynamic>);
  }

  Future<void> voidDelivery(
    String matchId,
    String deliveryId, {
    required String reason,
  }) async {
    await _dio.post(
      '/matches/$matchId/deliveries/$deliveryId/void',
      data: {'reason': reason},
    );
  }

  Future<void> closeInnings(String matchId, int inningsNumber) async {
    await _dio.post('/matches/$matchId/innings/$inningsNumber/close');
  }

  /// Test matches only. Starts innings 3 once 1 and 2 have both closed.
  /// [enforceFollowOn] is required whenever the follow-on is available.
  Future<void> startNextTestInnings(
    String matchId, {
    bool? enforceFollowOn,
  }) async {
    await _dio.post(
      '/matches/$matchId/next-innings',
      data: {'enforce_follow_on': ?enforceFollowOn},
    );
  }

  /// Test matches only — pauses live scoring for the day.
  Future<void> recordStumps(String matchId) async {
    await _dio.post('/matches/$matchId/stumps');
  }

  /// Test matches only — starts the next scheduled day; 409s once
  /// days_per_match has been used up.
  Future<int> resumeTestPlay(String matchId) async {
    final res = await _dio.post('/matches/$matchId/resume-play');
    return (res.data as Map<String, dynamic>)['day'] as int;
  }

  /// Test matches only — the organiser explicitly ends the match with no
  /// result; the app never infers a draw from elapsed time on its own.
  Future<void> drawMatch(String matchId) async {
    await _dio.post('/matches/$matchId/draw');
  }

  Future<void> abandonMatch(String matchId, {required String reason}) async {
    await _dio.post('/matches/$matchId/abandon', data: {'reason': reason});
  }

  /// Only valid before the toss — for a match that never started (ground
  /// unavailable, a team withdrew). Carries no result and never counts
  /// toward standings.
  Future<void> cancelMatch(String matchId, {required String reason}) async {
    await _dio.post('/matches/$matchId/cancel', data: {'reason': reason});
  }

  /// A team fails to show up / concedes — unlike abandon, this is a
  /// decisive result: winnerTeamId gets the win and its points.
  Future<void> forfeitMatch(
    String matchId, {
    required String winnerTeamId,
    String? reason,
  }) async {
    await _dio.post(
      '/matches/$matchId/forfeit',
      data: {'winner_team_id': winnerTeamId, 'reason': ?reason},
    );
  }

  /// Records a rain/weather stoppage under CricHive's own rain-rule method
  /// (see [MatchInterruption]) and revises the chasing target server-side.
  Future<void> recordInterruption(
    String matchId,
    int inningsNumber, {
    required double oversRemainingAfter,
    String? reason,
  }) async {
    await _dio.post(
      '/matches/$matchId/innings/$inningsNumber/interruption',
      data: {
        'overs_remaining_after': oversRemainingAfter,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
    );
  }

  Future<TournamentRules> updateTournamentRules(
    String slug,
    Map<String, dynamic> fields,
  ) async {
    final res = await _dio.patch('/tournaments/$slug/rules', data: fields);
    return TournamentRules.fromJson(
      (res.data as Map<String, dynamic>)['rules'] as Map<String, dynamic>,
    );
  }

  /// Organiser-only. Pass an empty string for [logoUrl] to clear it.
  Future<void> updateTournamentBranding(
    String slug, {
    String? logoUrl,
    String? organizerOrg,
  }) async {
    await _dio.patch(
      '/tournaments/$slug',
      data: {'logo_url': ?logoUrl, 'organizer_org': ?organizerOrg},
    );
  }

  // ---------------------------------------------------------------------
  // GDPR data requests
  // ---------------------------------------------------------------------

  Future<void> submitDataRequest({
    required String raisedByEmail,
    required String kind,
    String? playerId,
    String? details,
  }) async {
    await _dio.post(
      '/data-requests',
      data: {
        'raised_by_email': raisedByEmail,
        'kind': kind,
        if (playerId != null && playerId.isNotEmpty) 'player_id': playerId,
        if (details != null && details.isNotEmpty) 'details': details,
      },
    );
  }

  /// Platform-admin only.
  Future<List<DataRequest>> getDataRequests({String? status}) async {
    final res = await _dio.get(
      '/data-requests',
      queryParameters: {'status': ?status},
    );
    final list = (res.data as Map<String, dynamic>)['data_requests'] as List;
    return list.cast<Map<String, dynamic>>().map(DataRequest.fromJson).toList();
  }

  /// Platform-admin only.
  Future<void> resolveDataRequest(
    String id, {
    required String status,
    String? resolutionNote,
  }) async {
    await _dio.patch(
      '/data-requests/$id',
      data: {'status': status, 'resolution_note': ?resolutionNote},
    );
  }

  // ---------------------------------------------------------------------
  // Public read routes
  // ---------------------------------------------------------------------

  Future<Paginated<Tournament>> getTournaments({
    int page = 1,
    int limit = 20,
    String? q,
    String? country,
    int? seasonYear,
    String? ball,
  }) async {
    final res = await _dio.get(
      '/tournaments',
      queryParameters: {
        'page': page,
        'limit': limit,
        'q': ?q,
        'country': ?country,
        'season_year': ?seasonYear?.toString(),
        'ball': ?ball,
      },
    );
    return Paginated.fromJson(
      res.data as Map<String, dynamic>,
      Tournament.fromJson,
    );
  }

  Future<Tournament> getTournament(String slug) async {
    final res = await _dio.get('/tournaments/$slug');
    return Tournament.fromJson(res.data as Map<String, dynamic>);
  }

  /// Creates a tournament; the caller becomes its organizer immediately.
  /// Whether it's publicly visible right away or waits for platform-admin
  /// approval depends on the current [PlatformSettings.organizerSignupMode].
  Future<Tournament> createTournament({
    required String name,
    required String slug,
    required int seasonYear,
    String matchType = 'limited_overs',
    int? oversPerInnings,
    int? maxOversPerBowler,
    int? daysPerMatch,
    int? followOnMargin,
    String? organizerOrg,
    String? ball,
  }) async {
    final res = await _dio.post(
      '/tournaments',
      data: {
        'name': name,
        'slug': slug,
        'season_year': seasonYear,
        'match_type': matchType,
        'overs_per_innings': ?oversPerInnings,
        'max_overs_per_bowler': ?maxOversPerBowler,
        'days_per_match': ?daysPerMatch,
        'follow_on_margin': ?followOnMargin,
        'organizer_org': ?organizerOrg,
        'ball': ?ball,
      },
    );
    return Tournament.fromJson(
      (res.data as Map<String, dynamic>)['tournament'] as Map<String, dynamic>,
    );
  }

  Future<PlatformSettings> getPlatformSettings() async {
    final res = await _dio.get('/platform/settings');
    return PlatformSettings.fromJson(res.data as Map<String, dynamic>);
  }

  Future<PlatformSettings> updatePlatformSettings({
    required String organizerSignupMode,
  }) async {
    final res = await _dio.patch(
      '/platform/settings',
      data: {'organizer_signup_mode': organizerSignupMode},
    );
    return PlatformSettings.fromJson(res.data as Map<String, dynamic>);
  }

  Future<List<PendingTournament>> getPendingTournaments() async {
    final res = await _dio.get('/tournaments/pending');
    final list = (res.data as Map<String, dynamic>)['tournaments'] as List;
    return list
        .cast<Map<String, dynamic>>()
        .map(PendingTournament.fromJson)
        .toList();
  }

  Future<void> approveTournament(String slug) async {
    await _dio.post('/tournaments/$slug/approve');
  }

  Future<Paginated<Team>> getTeams(
    String slug, {
    int page = 1,
    int limit = 50,
  }) async {
    final res = await _dio.get(
      '/tournaments/$slug/teams',
      queryParameters: {'page': page, 'limit': limit},
    );
    return Paginated.fromJson(res.data as Map<String, dynamic>, Team.fromJson);
  }

  Future<KnockoutBracket> getKnockoutBracket(String slug) async {
    final res = await _dio.get('/tournaments/$slug/knockout');
    return KnockoutBracket.fromJson(res.data as Map<String, dynamic>);
  }

  /// [teamIdsBySeed] is seed order — first entry is the top seed. Organiser-only.
  Future<void> createKnockoutBracket(
    String slug, {
    String? name,
    required List<String> teamIdsBySeed,
  }) async {
    await _dio.post(
      '/tournaments/$slug/knockout',
      data: {
        if (name != null && name.isNotEmpty) 'name': name,
        'team_ids': teamIdsBySeed,
      },
    );
  }

  Future<Paginated<Fixture>> getFixtures(
    String slug, {
    String? group,
    String? date,
    String? team,
    String? status,
    int page = 1,
    int limit = 30,
  }) async {
    final res = await _dio.get(
      '/tournaments/$slug/fixtures',
      queryParameters: {
        'page': page,
        'limit': limit,
        'group': ?group,
        'date': ?date,
        'team': ?team,
        'status': ?status,
      },
    );
    return Paginated.fromJson(
      res.data as Map<String, dynamic>,
      Fixture.fromJson,
    );
  }

  Future<List<StandingGroup>> getStandings(String slug) async {
    final res = await _dio.get('/tournaments/$slug/standings');
    final groups = (res.data as Map<String, dynamic>)['groups'] as List;
    return groups
        .cast<Map<String, dynamic>>()
        .map(StandingGroup.fromJson)
        .toList();
  }

  Future<TournamentAwards> getTournamentAwards(String slug) async {
    final res = await _dio.get('/tournaments/$slug/awards');
    return TournamentAwards.fromJson(res.data as Map<String, dynamic>);
  }

  Future<List<SquadPlayer>> getSquad(
    String teamId,
    String tournamentSlug,
  ) async {
    final res = await _dio.get('/teams/$teamId/squad/$tournamentSlug');
    final squad = (res.data as Map<String, dynamic>)['squad'] as List;
    return squad
        .cast<Map<String, dynamic>>()
        .map(SquadPlayer.fromJson)
        .toList();
  }

  /// Same shape as [getSquad] but includes pending (not-yet-approved)
  /// entries too — only visible to the tournament's organiser or that
  /// team's own manager.
  Future<List<SquadPlayer>> getManagedSquad(
    String tournamentSlug,
    String teamId,
  ) async {
    final res = await _dio.get(
      '/tournaments/$tournamentSlug/teams/$teamId/squad/manage',
    );
    final squad = (res.data as Map<String, dynamic>)['squad'] as List;
    return squad
        .cast<Map<String, dynamic>>()
        .map(SquadPlayer.fromJson)
        .toList();
  }

  /// Organiser adding a player is approved immediately; a team manager's
  /// addition is a proposal that sits pending until the organiser approves it.
  Future<void> addSquadPlayer(
    String tournamentSlug,
    String teamId, {
    required String playerId,
    int? jerseyNumber,
    bool? isCaptain,
    bool? isKeeper,
  }) async {
    await _dio.post(
      '/tournaments/$tournamentSlug/teams/$teamId/squad',
      data: {
        'player_id': playerId,
        'jersey_number': ?jerseyNumber,
        'is_captain': ?isCaptain,
        'is_keeper': ?isKeeper,
      },
    );
  }

  /// Editing an already-approved entry as a team manager reopens it for
  /// organiser review — the server, not the client, decides that.
  Future<void> editSquadPlayer(
    String tournamentSlug,
    String teamId,
    String playerId, {
    int? jerseyNumber,
    bool? isCaptain,
    bool? isKeeper,
  }) async {
    await _dio.patch(
      '/tournaments/$tournamentSlug/teams/$teamId/squad/$playerId',
      data: {
        'jersey_number': ?jerseyNumber,
        'is_captain': ?isCaptain,
        'is_keeper': ?isKeeper,
      },
    );
  }

  Future<void> removeSquadPlayer(
    String tournamentSlug,
    String teamId,
    String playerId,
  ) async {
    await _dio.delete(
      '/tournaments/$tournamentSlug/teams/$teamId/squad/$playerId',
    );
  }

  /// Organiser-only: confirms the squad placement and records the manual
  /// Suomisport licence check in the same step.
  Future<void> approveSquadPlayer(
    String tournamentSlug,
    String teamId,
    String playerId, {
    required bool licenceVerified,
  }) async {
    await _dio.post(
      '/tournaments/$tournamentSlug/teams/$teamId/squad/$playerId/approve',
      data: {'licence_verified': licenceVerified},
    );
  }

  Future<List<TeamManager>> getTeamManagers(
    String tournamentSlug,
    String teamId,
  ) async {
    final res = await _dio.get(
      '/tournaments/$tournamentSlug/teams/$teamId/managers',
    );
    final managers = (res.data as Map<String, dynamic>)['managers'] as List;
    return managers
        .cast<Map<String, dynamic>>()
        .map(TeamManager.fromJson)
        .toList();
  }

  /// The person must already have a CricHive account. Returns the matched
  /// account so the caller can confirm it's the right person before it's
  /// too late to catch a typo'd email.
  Future<TeamManager> grantTeamManager(
    String tournamentSlug,
    String teamId, {
    required String email,
  }) async {
    final res = await _dio.post(
      '/tournaments/$tournamentSlug/teams/$teamId/managers',
      data: {'email': email},
    );
    return TeamManager.fromJson(
      (res.data as Map<String, dynamic>)['membership'] as Map<String, dynamic>,
    );
  }

  Future<void> revokeTeamManager(
    String tournamentSlug,
    String teamId,
    String membershipId,
  ) async {
    await _dio.delete(
      '/tournaments/$tournamentSlug/teams/$teamId/managers/$membershipId',
    );
  }

  // ---------------------------------------------------------------------
  // Scorers — tournament-wide grant (who may ever score for this
  // tournament) plus per-match assignment (which of those matches they may
  // actually act on). With several matches running at once, only the
  // assignment lets someone in.
  // ---------------------------------------------------------------------

  Future<List<TeamManager>> getTournamentScorers(String tournamentSlug) async {
    final res = await _dio.get('/tournaments/$tournamentSlug/scorers');
    final scorers = (res.data as Map<String, dynamic>)['scorers'] as List;
    return scorers
        .cast<Map<String, dynamic>>()
        .map(TeamManager.fromJson)
        .toList();
  }

  /// The person must already have a CricHive account. Returns the matched
  /// account so the caller can confirm it's the right person before it's
  /// too late to catch a typo'd email.
  Future<TeamManager> grantTournamentScorer(
    String tournamentSlug, {
    required String email,
  }) async {
    final res = await _dio.post(
      '/tournaments/$tournamentSlug/scorers',
      data: {'email': email},
    );
    return TeamManager.fromJson(
      (res.data as Map<String, dynamic>)['membership'] as Map<String, dynamic>,
    );
  }

  Future<void> revokeTournamentScorer(
    String tournamentSlug,
    String membershipId,
  ) async {
    await _dio.delete('/tournaments/$tournamentSlug/scorers/$membershipId');
  }

  Future<List<MatchScorer>> getMatchScorers(String matchId) async {
    final res = await _dio.get('/matches/$matchId/scorers');
    final scorers = (res.data as Map<String, dynamic>)['scorers'] as List;
    return scorers
        .cast<Map<String, dynamic>>()
        .map(MatchScorer.fromJson)
        .toList();
  }

  Future<void> assignMatchScorer(
    String matchId, {
    required String userId,
  }) async {
    await _dio.post('/matches/$matchId/scorers', data: {'user_id': userId});
  }

  Future<void> unassignMatchScorer(String matchId, String userId) async {
    await _dio.delete('/matches/$matchId/scorers/$userId');
  }

  Future<List<Player>> searchPlayers(String query) async {
    final res = await _dio.get(
      '/players/search',
      queryParameters: {'q': query},
    );
    final data = (res.data as Map<String, dynamic>)['data'] as List;
    return data.cast<Map<String, dynamic>>().map(Player.fromJson).toList();
  }

  Future<PlayerDetail> getPlayer(String id) async {
    final res = await _dio.get('/players/$id');
    return PlayerDetail.fromJson(res.data as Map<String, dynamic>);
  }

  Future<MatchDetail> getMatch(String id) async {
    final res = await _dio.get('/matches/$id');
    return MatchDetail.fromJson(res.data as Map<String, dynamic>);
  }

  /// Full ball-by-ball feed for one innings, transparently walking every
  /// page (the server caps a single page at 100) so chart code always gets
  /// the complete innings regardless of format length.
  Future<List<Delivery>> getDeliveries(
    String matchId,
    int inningsNumber,
  ) async {
    final all = <Delivery>[];
    var page = 1;
    while (true) {
      final res = await _dio.get(
        '/matches/$matchId/innings/$inningsNumber/deliveries',
        queryParameters: {'page': page, 'limit': 100},
      );
      final body = res.data as Map<String, dynamic>;
      final rows = (body['data'] as List).cast<Map<String, dynamic>>().map(
        Delivery.fromJson,
      );
      all.addAll(rows);
      final pageInfo = body['pagination'] as Map<String, dynamic>;
      if (page >= (pageInfo['total_pages'] as int)) break;
      page++;
    }
    return all;
  }

  Future<List<LiveMatch>> getLiveMatches() async {
    final res = await _dio.get('/live');
    final matches = (res.data as Map<String, dynamic>)['matches'] as List;
    return matches
        .cast<Map<String, dynamic>>()
        .map(LiveMatch.fromJson)
        .toList();
  }
}
