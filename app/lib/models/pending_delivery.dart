/// A delivery that couldn't reach the server (no network) and is queued
/// locally for retry. Carries the exact same fields as
/// [ApiClient.postDelivery] plus the `client_event_id` it was first
/// submitted with, so a later retry is idempotent even if the original
/// request actually landed before the connection dropped.
class PendingDelivery {
  const PendingDelivery({
    required this.matchId,
    required this.clientEventId,
    required this.inningsNumber,
    required this.strikerId,
    required this.nonStrikerId,
    required this.bowlerId,
    required this.runsOffBat,
    required this.extraWides,
    required this.extraNoballs,
    required this.extraByes,
    required this.extraLegbyes,
    required this.extraPenalty,
    this.wicketKind,
    this.playerOutId,
    this.fielderId,
    required this.queuedAt,
  });

  final String matchId;
  final String clientEventId;
  final int inningsNumber;
  final String strikerId;
  final String nonStrikerId;
  final String bowlerId;
  final int runsOffBat;
  final int extraWides;
  final int extraNoballs;
  final int extraByes;
  final int extraLegbyes;
  final int extraPenalty;
  final String? wicketKind;
  final String? playerOutId;
  final String? fielderId;
  final DateTime queuedAt;

  Map<String, dynamic> toJson() => {
        'match_id': matchId,
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
        'wicket_kind': wicketKind,
        'player_out_id': playerOutId,
        'fielder_id': fielderId,
        'queued_at': queuedAt.toIso8601String(),
      };

  factory PendingDelivery.fromJson(Map<String, dynamic> json) => PendingDelivery(
        matchId: json['match_id'] as String,
        clientEventId: json['client_event_id'] as String,
        inningsNumber: json['innings_number'] as int,
        strikerId: json['striker_id'] as String,
        nonStrikerId: json['non_striker_id'] as String,
        bowlerId: json['bowler_id'] as String,
        runsOffBat: json['runs_off_bat'] as int,
        extraWides: json['extra_wides'] as int,
        extraNoballs: json['extra_noballs'] as int,
        extraByes: json['extra_byes'] as int,
        extraLegbyes: json['extra_legbyes'] as int,
        extraPenalty: json['extra_penalty'] as int,
        wicketKind: json['wicket_kind'] as String?,
        playerOutId: json['player_out_id'] as String?,
        fielderId: json['fielder_id'] as String?,
        queuedAt: DateTime.parse(json['queued_at'] as String),
      );
}
