import 'package:flutter/material.dart';

import 'manhattan_chart.dart';
import '../theme/chart_palette.dart';

class WormSeries {
  const WormSeries({required this.label, required this.overs});
  final String label;
  final List<OverAggregate> overs;
}

/// Worm chart: cumulative runs by over, one line per innings, sharing a
/// single runs axis and a single overs axis (never a dual-axis chart even
/// with two series — both series are the same unit).
class WormChart extends StatelessWidget {
  const WormChart({super.key, required this.series});

  final List<WormSeries> series;

  @override
  Widget build(BuildContext context) {
    final nonEmpty = series.where((s) => s.overs.isNotEmpty).toList();
    if (nonEmpty.isEmpty) {
      return const Padding(padding: EdgeInsets.all(16), child: Text('No overs bowled yet.'));
    }

    final cumulative = nonEmpty
        .map((s) {
          var running = 0;
          final points = <double>[0];
          for (final o in s.overs) {
            running += o.runs;
            points.add(running.toDouble());
          }
          return points;
        })
        .toList();
    final maxRuns = cumulative.expand((p) => p).fold(0.0, (a, b) => a > b ? a : b);
    final maxOvers = nonEmpty.map((s) => s.overs.length).fold(0, (a, b) => a > b ? a : b);
    final brightness = Theme.of(context).brightness;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 180,
          child: LayoutBuilder(
            builder: (context, constraints) => CustomPaint(
              size: Size(constraints.maxWidth, 180),
              painter: _WormPainter(
                seriesPoints: cumulative,
                maxRuns: maxRuns == 0 ? 1 : maxRuns,
                maxOvers: maxOvers == 0 ? 1 : maxOvers,
                colors: [for (var i = 0; i < nonEmpty.length; i++) ChartPalette.categorical(i, brightness)],
                gridColor: ChartPalette.gridline(context),
              ),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 16,
          children: [
            for (var i = 0; i < nonEmpty.length; i++)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(width: 10, height: 10, color: ChartPalette.categorical(i, brightness)),
                  const SizedBox(width: 4),
                  Text(nonEmpty[i].label, style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
          ],
        ),
      ],
    );
  }
}

class _WormPainter extends CustomPainter {
  _WormPainter({
    required this.seriesPoints,
    required this.maxRuns,
    required this.maxOvers,
    required this.colors,
    required this.gridColor,
  });

  final List<List<double>> seriesPoints;
  final double maxRuns;
  final int maxOvers;
  final List<Color> colors;
  final Color gridColor;

  @override
  void paint(Canvas canvas, Size size) {
    final gridPaint = Paint()
      ..color = gridColor
      ..strokeWidth = 1;
    for (var i = 0; i <= 2; i++) {
      final y = size.height - (size.height * i / 2);
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    for (var s = 0; s < seriesPoints.length; s++) {
      final points = seriesPoints[s];
      final path = Path();
      for (var i = 0; i < points.length; i++) {
        final x = size.width * (i / maxOvers);
        final y = size.height - size.height * (points[i] / maxRuns);
        if (i == 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = colors[s]
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..strokeCap = StrokeCap.round,
      );

      final lastX = size.width * ((points.length - 1) / maxOvers);
      final lastY = size.height - size.height * (points.last / maxRuns);
      canvas.drawCircle(Offset(lastX, lastY), 3, Paint()..color = colors[s]);
    }
  }

  @override
  bool shouldRepaint(covariant _WormPainter oldDelegate) => oldDelegate.seriesPoints != seriesPoints;
}
