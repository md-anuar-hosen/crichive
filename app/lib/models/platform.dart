class PlatformSettings {
  const PlatformSettings({required this.organizerSignupMode});

  final String organizerSignupMode; // 'open' | 'approval_required'

  bool get isOpen => organizerSignupMode == 'open';

  factory PlatformSettings.fromJson(Map<String, dynamic> json) =>
      PlatformSettings(organizerSignupMode: json['organizer_signup_mode'] as String);
}

class PendingTournamentCreator {
  const PendingTournamentCreator({required this.name, this.email});
  final String name;
  final String? email;

  factory PendingTournamentCreator.fromJson(Map<String, dynamic> json) =>
      PendingTournamentCreator(name: json['name'] as String, email: json['email'] as String?);
}

class PendingTournament {
  const PendingTournament({
    required this.id,
    required this.slug,
    required this.name,
    required this.seasonYear,
    required this.createdAt,
    required this.createdBy,
  });

  final String id;
  final String slug;
  final String name;
  final int seasonYear;
  final DateTime createdAt;
  final PendingTournamentCreator createdBy;

  factory PendingTournament.fromJson(Map<String, dynamic> json) => PendingTournament(
        id: json['id'] as String,
        slug: json['slug'] as String,
        name: json['name'] as String,
        seasonYear: json['season_year'] as int,
        createdAt: DateTime.parse(json['created_at'] as String),
        createdBy: PendingTournamentCreator.fromJson(json['created_by'] as Map<String, dynamic>),
      );
}
