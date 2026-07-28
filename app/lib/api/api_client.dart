import 'package:dio/dio.dart';

import '../models/fixture.dart';
import '../models/live_match.dart';
import '../models/match_detail.dart';
import '../models/pagination.dart';
import '../models/player.dart';
import '../models/standing.dart';
import '../models/team.dart';
import '../models/tournament.dart';
import 'api_exception.dart';

const _defaultBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:3000');

/// Wraps every backend route the app needs. Auth token attachment is wired
/// up via [setTokenProvider] once the auth layer exists (Phase 2) — Phase 1
/// only calls the public, unauthenticated routes.
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
        if (group != null) 'group': group,
        if (date != null) 'date': date,
        if (team != null) 'team': team,
        if (status != null) 'status': status,
      },
    );
    return Paginated.fromJson(res.data as Map<String, dynamic>, Fixture.fromJson);
  }

  Future<List<StandingGroup>> getStandings(String slug) async {
    final res = await _dio.get('/tournaments/$slug/standings');
    final groups = (res.data as Map<String, dynamic>)['groups'] as List;
    return groups.cast<Map<String, dynamic>>().map(StandingGroup.fromJson).toList();
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

  Future<List<LiveMatch>> getLiveMatches() async {
    final res = await _dio.get('/live');
    final matches = (res.data as Map<String, dynamic>)['matches'] as List;
    return matches.cast<Map<String, dynamic>>().map(LiveMatch.fromJson).toList();
  }
}
