/// Postgres NUMERIC/DECIMAL columns (e.g. `max_overs`, `net_run_rate`) are
/// serialized as JSON strings by node-pg/Express to avoid float precision
/// loss, not as JSON numbers. Every model field backed by such a column
/// must parse through this instead of a bare `as num`/`as double` cast.
double parseNumeric(dynamic value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.parse(value);
  throw FormatException('Expected a numeric value, got $value');
}

double? parseNumericOrNull(dynamic value) => value == null ? null : parseNumeric(value);
