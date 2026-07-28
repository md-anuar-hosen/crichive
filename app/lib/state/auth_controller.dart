import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_exception.dart';
import '../models/user.dart';
import 'providers.dart';

const _tokenStorageKey = 'crichive_jwt';

final secureStorageProvider = Provider<FlutterSecureStorage>((ref) => const FlutterSecureStorage());

enum AuthStatus { loading, unauthenticated, authenticated }

class AuthState {
  const AuthState({required this.status, this.token, this.user, this.error});

  final AuthStatus status;
  final String? token;
  final User? user;
  final String? error;

  static const loading = AuthState(status: AuthStatus.loading);
  static const unauthenticated = AuthState(status: AuthStatus.unauthenticated);

  AuthState copyWith({AuthStatus? status, String? token, User? user, String? error}) => AuthState(
        status: status ?? this.status,
        token: token ?? this.token,
        user: user ?? this.user,
        error: error,
      );
}

/// Hydrates from stored token on first read, exposes login/register/logout.
/// The JWT never carries roles (they can change) — every screen that needs
/// to know what a user can do re-checks with the backend rather than
/// trusting a cached role.
class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    final api = ref.watch(apiClientProvider);
    api.setTokenProvider(() => state.token);
    api.onUnauthorized = () {
      if (state.status == AuthStatus.authenticated) {
        _clearToken();
        state = AuthState.unauthenticated;
      }
    };
    _hydrate();
    return AuthState.loading;
  }

  Future<void> _hydrate() async {
    final storage = ref.read(secureStorageProvider);
    final token = await storage.read(key: _tokenStorageKey);
    if (token == null) {
      state = AuthState.unauthenticated;
      return;
    }
    state = state.copyWith(status: AuthStatus.loading, token: token);
    try {
      final user = await ref.read(apiClientProvider).me();
      state = AuthState(status: AuthStatus.authenticated, token: token, user: user);
    } catch (_) {
      await _clearToken();
      state = AuthState.unauthenticated;
    }
  }

  Future<void> login({required String email, required String password}) async {
    state = state.copyWith(status: AuthStatus.loading, error: null);
    try {
      final api = ref.read(apiClientProvider);
      final token = await api.login(email: email, password: password);
      await ref.read(secureStorageProvider).write(key: _tokenStorageKey, value: token);
      state = state.copyWith(status: AuthStatus.loading, token: token);
      final user = await api.me();
      state = AuthState(status: AuthStatus.authenticated, token: token, user: user);
    } on ApiException catch (e) {
      state = AuthState(status: AuthStatus.unauthenticated, error: e.message);
    }
  }

  Future<void> register({required String email, required String password, required String displayName}) async {
    state = state.copyWith(status: AuthStatus.loading, error: null);
    try {
      await ref.read(apiClientProvider).register(email: email, password: password, displayName: displayName);
      await login(email: email, password: password);
    } on ApiException catch (e) {
      state = AuthState(status: AuthStatus.unauthenticated, error: e.message);
    }
  }

  Future<void> logout() async {
    await _clearToken();
    state = AuthState.unauthenticated;
  }

  Future<void> _clearToken() => ref.read(secureStorageProvider).delete(key: _tokenStorageKey);
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);
