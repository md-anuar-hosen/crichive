import 'delivery.dart';

class DeliveryResult {
  const DeliveryResult({
    required this.delivery,
    required this.isDuplicate,
    this.inningsComplete,
    this.completionReason,
  });

  final Delivery delivery;
  final bool isDuplicate;
  final bool? inningsComplete;
  final String? completionReason;

  factory DeliveryResult.fromJson(Map<String, dynamic> json) => DeliveryResult(
        delivery: Delivery.fromJson(json['delivery'] as Map<String, dynamic>),
        isDuplicate: json['is_duplicate'] as bool? ?? false,
        inningsComplete: json['innings_complete'] as bool?,
        completionReason: json['completion_reason'] as String?,
      );
}
