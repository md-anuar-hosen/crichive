class ApiException implements Exception {
  const ApiException(this.statusCode, this.message, {this.fieldErrors});

  final int? statusCode;
  final String message;
  final List<Map<String, String>>? fieldErrors;

  @override
  String toString() => message;
}
