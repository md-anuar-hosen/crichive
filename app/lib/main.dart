import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'screens/live_screen.dart';
import 'screens/match_screen.dart';
import 'screens/player_profile_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/team_squad_screen.dart';
import 'screens/tournament_detail_screen.dart';
import 'screens/tournament_list_screen.dart';
import 'theme/app_theme.dart';

void main() {
  runApp(const ProviderScope(child: CricHiveApp()));
}

final _router = GoRouter(
  initialLocation: '/tournaments',
  routes: [
    StatefulShellRoute.indexedStack(
      builder: (context, state, shell) => _RootShell(shell: shell),
      branches: [
        StatefulShellBranch(routes: [
          GoRoute(path: '/tournaments', builder: (context, state) => const TournamentListScreen()),
        ]),
        StatefulShellBranch(routes: [
          GoRoute(path: '/live', builder: (context, state) => const LiveScreen()),
        ]),
        StatefulShellBranch(routes: [
          GoRoute(path: '/profile', builder: (context, state) => const ProfileScreen()),
        ]),
      ],
    ),
    GoRoute(
      path: '/tournaments/:slug',
      builder: (context, state) => TournamentDetailScreen(slug: state.pathParameters['slug']!),
    ),
    GoRoute(
      path: '/teams/:teamId/squad/:slug',
      builder: (context, state) => TeamSquadScreen(
        teamId: state.pathParameters['teamId']!,
        tournamentSlug: state.pathParameters['slug']!,
      ),
    ),
    GoRoute(
      path: '/players/:id',
      builder: (context, state) => PlayerProfileScreen(playerId: state.pathParameters['id']!),
    ),
    GoRoute(
      path: '/matches/:id',
      builder: (context, state) => MatchScreen(matchId: state.pathParameters['id']!),
    ),
  ],
);

class CricHiveApp extends StatelessWidget {
  const CricHiveApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'CricHive',
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      routerConfig: _router,
    );
  }
}

class _RootShell extends StatelessWidget {
  const _RootShell({required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (index) => shell.goBranch(index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.emoji_events_outlined), selectedIcon: Icon(Icons.emoji_events), label: 'Tournaments'),
          NavigationDestination(icon: Icon(Icons.live_tv_outlined), selectedIcon: Icon(Icons.live_tv), label: 'Live'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}
