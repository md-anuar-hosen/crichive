class DeliveryResult {
  const DeliveryResult({required this.isDuplicate, this.inningsComplete, this.completionReason});

  final bool isDuplicate;
  final bool? inningsComplete;
  final String? completionReason;

  factory DeliveryResult.fromJson(Map<String, dynamic> json) => DeliveryResult(
        isDuplicate: json['is_duplicate'] as bool? ?? false,
        inningsComplete: json['innings_complete'] as bool?,
        completionReason: json['completion_reason'] as String?,
      );
}
