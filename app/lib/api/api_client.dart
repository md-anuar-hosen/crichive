import 'package:dio/dio.dart';

import '../models/delivery.dart';
import '../models/delivery_result.dart';
import '../models/fixture.dart';
import '../models/live_match.dart';
import '../models/match_detail.dart';
import '../models/pagination.dart';
import '../models/player.dart';
import '../models/standing.dart';
import '../models/team.dart';
import '../models/tournament.dart';
import '../models/tournament_awards.dart';
import '../models/user.dart';
import 'api_exception.dart';

const _defaultBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:3000');

/// Wraps every backend route the app needs. [setTokenProvider] wires in the
/// current JWT (if any) via an interceptor; scoring routes 403 server-side
/// for users without the right tournament role.
class ApiClient {
  ApiClient({String? baseUrl}) : _dio = Dio(BaseOptions(baseUrl: baseUrl ?? _defaultBaseUrl)) {
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

  void setTokenProvider(String? Function()? provider) => _tokenProvider = provider;

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
            .map((f) => {'field': f['field'] as String, 'message': f['message'] as String})
            .toList();
      }
    }
    return error.copyWith(error: ApiException(response?.statusCode, message, fieldErrors: fieldErrors));
  }

  // ---------------------------------------------------------------------
  // Auth routes
  // ---------------------------------------------------------------------

  Future<User> register({required String email, required String password, required String displayName}) async {
    final res = await _dio.post(
      '/auth/register',
      data: {'email': email, 'password': password, 'display_name': displayName},
    );
    return User.fromJson((res.data as Map<String, dynamic>)['user'] as Map<String, dynamic>);
  }

  Future<String> login({required String email, required String password}) async {
    final res = await _dio.post('/auth/login', data: {'email': email, 'password': password});
    return (res.data as Map<String, dynamic>)['token'] as String;
  }

  Future<User> me() async {
    final res = await _dio.get('/auth/me');
    return User.fromJson((res.data as Map<String, dynamic>)['user'] as Map<String, dynamic>);
  }

  // ---------------------------------------------------------------------
  // Scoring routes (organizer/scorer only -- enforced server-side; a 403
  // here means this user lacks the tournament role, not a client bug)
  // ---------------------------------------------------------------------

  Future<void> recordToss(String matchId, {required String winnerTeamId, required String decision}) async {
    await _dio.post('/matches/$matchId/toss', data: {'winner_team_id': winnerTeamId, 'decision': decision});
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
      },
    );
    return DeliveryResult.fromJson(res.data as Map<String, dynamic>);
  }

  Future<void> voidDelivery(String matchId, String deliveryId, {required String reason}) async {
    await _dio.post('/matches/$matchId/deliveries/$deliveryId/void', data: {'reason': reason});
  }

  Future<void> closeInnings(String matchId, int inningsNumber) async {
    await _dio.post('/matches/$matchId/innings/$inningsNumber/close');
  }

  Future<void> abandonMatch(String matchId, {required String reason}) async {
    await _dio.post('/matches/$matchId/abandon', data: {'reason': reason});
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
      data: {'overs_remaining_after': oversRemainingAfter, if (reason != null && reason.isNotEmpty) 'reason': reason},
    );
  }

  Future<TournamentRules> updateTournamentRules(String slug, Map<String, dynamic> fields) async {
    final res = await _dio.patch('/tournaments/$slug/rules', data: fields);
    return TournamentRules.fromJson((res.data as Map<String, dynamic>)['rules'] as Map<String, dynamic>);
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

  // ---------------------------------------------------------------------
  // Public read routes
  // ---------------------------------------------------------------------

  Future<Paginated<Tournament>> getTournaments({int page = 1, int limit = 20}) async {
    final res = await _dio.get('/tournaments', queryParameters: {'page': page, 'limit': limit});
    return Paginated.fromJson(res.data as Map<String, dynamic>, Tournament.fromJson);
  }

  Future<Tournament> getTournament(String slug) async {
    final res = await _dio.get('/tournaments/$slug');
    return Tournament.fromJson(res.data as Map<String, dynamic>);
  }

  Future<Paginated<Team>> getTeams(String slug, {int page = 1, int limit = 50}) async {
    final res = await _dio.get('/tournaments/$slug/teams', queryParameters: {'page': page, 'limit': limit});
    return Paginated.fromJson(res.data as Map<String, dynamic>, Team.fromJson);
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
    return Paginated.fromJson(res.data as Map<String, dynamic>, Fixture.fromJson);
  }

  Future<List<StandingGroup>> getStandings(String slug) async {
    final res = await _dio.get('/tournaments/$slug/standings');
    final groups = (res.data as Map<String, dynamic>)['groups'] as List;
    return groups.cast<Map<String, dynamic>>().map(StandingGroup.fromJson).toList();
  }

  Future<TournamentAwards> getTournamentAwards(String slug) async {
    final res = await _dio.get('/tournaments/$slug/awards');
    return TournamentAwards.fromJson(res.data as Map<String, dynamic>);
  }

  Future<Team> getTeam(String id) async {
    final res = await _dio.get('/teams/$id');
    return Team.fromJson(res.data as Map<String, dynamic>);
  }

  Future<List<SquadPlayer>> getSquad(String teamId, String tournamentSlug) async {
    final res = await _dio.get('/teams/$teamId/squad/$tournamentSlug');
    final squad = (res.data as Map<String, dynamic>)['squad'] as List;
    return squad.cast<Map<String, dynamic>>().map(SquadPlayer.fromJson).toList();
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
  Future<List<Delivery>> getDeliveries(String matchId, int inningsNumber) async {
    final all = <Delivery>[];
    var page = 1;
    while (true) {
      final res = await _dio.get(
        '/matches/$matchId/innings/$inningsNumber/deliveries',
        queryParameters: {'page': page, 'limit': 100},
      );
      final body = res.data as Map<String, dynamic>;
      final rows = (body['data'] as List).cast<Map<String, dynamic>>().map(Delivery.fromJson);
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
    return matches.cast<Map<String, dynamic>>().map(LiveMatch.fromJson).toList();
  }
}
