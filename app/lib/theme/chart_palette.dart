import 'package:flutter/material.dart';

/// Validated categorical/sequential palette for match charts (Manhattan,
/// Worm, wagon wheel). Fixed hue order is the CVD-safety mechanism — never
/// reassign or cycle these; a chart with N series always uses the first N
/// slots in this exact order. See the dataviz skill's palette.md for the
/// validation this was derived from.
class ChartPalette {
  static const _categoricalLight = [
    Color(0xFF2A78D6), // 1 blue
    Color(0xFF1BAF7A), // 2 aqua
    Color(0xFFEDA100), // 3 yellow
    Color(0xFF008300), // 4 green
    Color(0xFF4A3AA7), // 5 violet
    Color(0xFFE34948), // 6 red
    Color(0xFFE87BA4), // 7 magenta
    Color(0xFFEB6834), // 8 orange
  ];

  static const _categoricalDark = [
    Color(0xFF3987E5),
    Color(0xFF199E70),
    Color(0xFFC98500),
    Color(0xFF008300),
    Color(0xFF9085E9),
    Color(0xFFE66767),
    Color(0xFFD55181),
    Color(0xFFD95926),
  ];

  static Color categorical(int slot, Brightness brightness) {
    final list = brightness == Brightness.dark ? _categoricalDark : _categoricalLight;
    return list[slot % list.length];
  }

  /// Sequential blue ramp, light -> dark, for ordinal run-value encoding
  /// (wagon wheel dot: higher runs = darker/more saturated).
  static const _sequentialLight = [
    Color(0xFFCDE2FB), // 100
    Color(0xFF9EC5F4), // 200
    Color(0xFF6DA7EC), // 300
    Color(0xFF3987E5), // 400
    Color(0xFF256ABF), // 500
    Color(0xFF184F95), // 600
  ];

  static Color sequentialStep(int index, {int maxIndex = 5}) {
    final clamped = index.clamp(0, maxIndex);
    final scaled = (clamped / maxIndex * (_sequentialLight.length - 1)).round();
    return _sequentialLight[scaled];
  }

  static const statusCritical = Color(0xFFD03B3B);

  static Color mutedInk(BuildContext context) => Theme.of(context).colorScheme.outline;
  static Color gridline(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? const Color(0xFF2C2C2A) : const Color(0xFFE1E0D9);
}
