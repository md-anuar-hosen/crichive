class DataRequest {
  const DataRequest({
    required this.id,
    required this.playerId,
    required this.raisedByEmail,
    required this.kind,
    required this.details,
    required this.status,
    required this.resolutionNote,
    required this.createdAt,
    required this.resolvedAt,
  });

  final String id;
  final String? playerId;
  final String raisedByEmail;
  final String kind;
  final String? details;
  final String status;
  final String? resolutionNote;
  final DateTime createdAt;
  final DateTime? resolvedAt;

  factory DataRequest.fromJson(Map<String, dynamic> json) => DataRequest(
        id: json['id'] as String,
        playerId: json['player_id'] as String?,
        raisedByEmail: json['raised_by_email'] as String,
        kind: json['kind'] as String,
        details: json['details'] as String?,
        status: json['status'] as String,
        resolutionNote: json['resolution_note'] as String?,
        createdAt: DateTime.parse(json['created_at'] as String),
        resolvedAt: json['resolved_at'] == null ? null : DateTime.parse(json['resolved_at'] as String),
      );
}
