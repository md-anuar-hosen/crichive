import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models/delivery.dart';
import '../theme/chart_palette.dart';

/// Wagon wheel: shot placement scatter, angle + distance per scoring
/// delivery. Colored by runs (ordinal magnitude -> one-hue sequential ramp,
/// not a categorical palette — "how many runs" is a magnitude, not an
/// identity).
class WagonWheel extends StatelessWidget {
  const WagonWheel({super.key, required this.deliveries});

  final List<Delivery> deliveries;

  static const _runBuckets = [0, 1, 2, 3, 4, 6];

  @override
  Widget build(BuildContext context) {
    final shots = deliveries.where((d) => d.wagonAngleDeg != null && d.wagonDistance != null).toList();
    if (shots.isEmpty) {
      return const Padding(padding: EdgeInsets.all(16), child: Text('No wagon wheel data recorded for this innings.'));
    }
    final maxDistance = shots.map((d) => d.wagonDistance!).fold(1, (a, b) => a > b ? a : b);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AspectRatio(
          aspectRatio: 1,
          child: CustomPaint(
            painter: _WagonPainter(
              shots: shots,
              maxDistance: maxDistance.toDouble(),
              ringColor: ChartPalette.gridline(context),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text('Runs:', style: Theme.of(context).textTheme.bodySmall),
            for (var i = 0; i < _runBuckets.length; i++)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      color: ChartPalette.sequentialStep(i, maxIndex: _runBuckets.length - 1),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Text('${_runBuckets[i]}', style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
          ],
        ),
      ],
    );
  }
}

class _WagonPainter extends CustomPainter {
  _WagonPainter({required this.shots, required this.maxDistance, required this.ringColor});

  final List<Delivery> shots;
  final double maxDistance;
  final Color ringColor;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = math.min(size.width, size.height) / 2 - 8;

    final ringPaint = Paint()
      ..color = ringColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    for (final f in [0.33, 0.66, 1.0]) {
      canvas.drawCircle(center, radius * f, ringPaint);
    }
    canvas.drawLine(center - Offset(radius, 0), center + Offset(radius, 0), ringPaint);
    canvas.drawLine(center - Offset(0, radius), center + Offset(0, radius), ringPaint);

    for (final d in shots) {
      final angleRad = (d.wagonAngleDeg! - 90) * math.pi / 180;
      final dist = (d.wagonDistance! / maxDistance).clamp(0.05, 1.0) * radius;
      final point = center + Offset(math.cos(angleRad), math.sin(angleRad)) * dist;
      final bucketIndex = WagonWheel._runBuckets.lastIndexWhere((r) => r <= d.runsOffBat).clamp(0, WagonWheel._runBuckets.length - 1);
      final color = ChartPalette.sequentialStep(bucketIndex, maxIndex: WagonWheel._runBuckets.length - 1);
      canvas.drawCircle(point, 4, Paint()..color = color);
      canvas.drawCircle(point, 4, Paint()..color = Colors.black.withValues(alpha: 0.12)..style = PaintingStyle.stroke..strokeWidth = 1);
    }
  }

  @override
  bool shouldRepaint(covariant _WagonPainter oldDelegate) => oldDelegate.shots != shots;
}
