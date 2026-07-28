class TeamRef {
  const TeamRef({required this.id, required this.name, this.shortName});

  final String id;
  final String name;
  final String? shortName;

  factory TeamRef.fromJson(Map<String, dynamic> json) => TeamRef(
        id: json['id'] as String,
        name: json['name'] as String,
        shortName: json['short_name'] as String?,
      );

  String get label => shortName ?? name;
}

class Team {
  const Team({required this.id, required this.name, this.shortName, this.logoUrl, this.homeCity});

  final String id;
  final String name;
  final String? shortName;
  final String? logoUrl;
  final String? homeCity;

  factory Team.fromJson(Map<String, dynamic> json) => Team(
        id: json['id'] as String,
        name: json['name'] as String,
        shortName: json['short_name'] as String?,
        logoUrl: json['logo_url'] as String?,
        homeCity: json['home_city'] as String?,
      );

  String get label => shortName ?? name;
}

class GroundRef {
  const GroundRef({required this.id, required this.name, this.city});

  final String id;
  final String name;
  final String? city;

  factory GroundRef.fromJson(Map<String, dynamic> json) => GroundRef(
        id: json['id'] as String,
        name: json['name'] as String,
        city: json['city'] as String?,
      );
}
