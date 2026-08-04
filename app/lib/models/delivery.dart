class Delivery {
  const Delivery({
    required this.id,
    required this.overNumber,
    required this.ballInOver,
    required this.sequence,
    required this.strikerId,
    required this.nonStrikerId,
    required this.bowlerId,
    required this.runsOffBat,
    required this.extraWides,
    required this.extraNoballs,
    required this.extraByes,
    required this.extraLegbyes,
    required this.extraPenalty,
    required this.isLegalDelivery,
    required this.isFreeHit,
    this.wicketKind,
    this.playerOutId,
    this.fielderId,
    this.wagonAngleDeg,
    this.wagonDistance,
    this.commentary,
  });

  final String id;
  final int overNumber;
  final int ballInOver;
  final int sequence;
  final String strikerId;
  final String nonStrikerId;
  final String bowlerId;
  final int runsOffBat;
  final int extraWides;
  final int extraNoballs;
  final int extraByes;
  final int extraLegbyes;
  final int extraPenalty;
  final bool isLegalDelivery;
  final bool isFreeHit;
  final String? wicketKind;
  final String? playerOutId;
  final String? fielderId;
  final int? wagonAngleDeg;
  final int? wagonDistance;
  final String? commentary;

  int get totalRuns => runsOffBat + extraWides + extraNoballs + extraByes + extraLegbyes + extraPenalty;
  bool get isWicket => wicketKind != null;

  factory Delivery.fromJson(Map<String, dynamic> json) => Delivery(
        id: json['id'] as String,
        overNumber: json['over_number'] as int,
        ballInOver: json['ball_in_over'] as int,
        sequence: json['sequence'] as int,
        strikerId: json['striker_id'] as String,
        nonStrikerId: json['non_striker_id'] as String,
        bowlerId: json['bowler_id'] as String,
        runsOffBat: json['runs_off_bat'] as int,
        extraWides: json['extra_wides'] as int,
        extraNoballs: json['extra_noballs'] as int,
        extraByes: json['extra_byes'] as int,
        extraLegbyes: json['extra_legbyes'] as int,
        extraPenalty: json['extra_penalty'] as int,
        isLegalDelivery: json['is_legal_delivery'] as bool,
        isFreeHit: json['is_free_hit'] as bool,
        wicketKind: json['wicket_kind'] as String?,
        playerOutId: json['player_out_id'] as String?,
        fielderId: json['fielder_id'] as String?,
        wagonAngleDeg: json['wagon_angle_deg'] as int?,
        wagonDistance: json['wagon_distance'] as int?,
        commentary: json['commentary'] as String?,
      );
}
