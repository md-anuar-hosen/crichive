import '../models/delivery.dart';

/// Falls back to a synthesized line when the scorer didn't type free-text
/// commentary for a ball. Purely descriptive of fields already on the
/// delivery — never infers anything the backend didn't already record.
String describeDelivery(Delivery d) {
  if (d.commentary != null && d.commentary!.trim().isNotEmpty) return d.commentary!;

  if (d.isWicket) {
    final kind = d.wicketKind!.replaceAll('_', ' ');
    return 'OUT! $kind';
  }
  if (d.extraWides > 0) return 'Wide${d.extraWides > 1 ? ', ${d.extraWides} run(s)' : ''}';
  if (d.extraNoballs > 0) {
    return 'No ball${d.runsOffBat > 0 ? ', ${d.runsOffBat} run(s)' : ''}';
  }
  if (d.extraByes > 0) return '${d.extraByes} bye(s)';
  if (d.extraLegbyes > 0) return '${d.extraLegbyes} leg bye(s)';
  if (d.runsOffBat == 0) return 'Dot ball';
  if (d.runsOffBat == 4) return 'FOUR!';
  if (d.runsOffBat == 6) return 'SIX!';
  return '${d.runsOffBat} run(s)';
}

String overBallLabel(Delivery d) => '${d.overNumber + 1}.${d.ballInOver}';
