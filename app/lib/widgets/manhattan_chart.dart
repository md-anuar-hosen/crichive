import 'package:flutter/material.dart';

import '../models/delivery.dart';
import '../theme/chart_palette.dart';

class OverAggregate {
  const OverAggregate({required this.overNumber, required this.runs, required this.wickets});
  final int overNumber;
  final int runs;
  final int wickets;
}

List<OverAggregate> aggregateByOver(List<Delivery> deliveries) {
  final byOver = <int, List<Delivery>>{};
  for (final d in deliveries) {
    byOver.putIfAbsent(d.overNumber, () => []).add(d);
  }
  final overs = byOver.keys.toList()..sort();
  return overs
      .map((o) => OverAggregate(
            overNumber: o,
            runs: byOver[o]!.fold(0, (sum, d) => sum + d.totalRuns),
            wickets: byOver[o]!.where((d) => d.isWicket).length,
          ))
      .toList();
}

/// Manhattan chart: runs scored per over as a bar chart, one series (this
/// innings), with a small marker above any over that contained a wicket.
/// Single series, so no legend is needed -- the card title names it.
class ManhattanChart extends StatefulWidget {
  const ManhattanChart({super.key, required this.overs, required this.seriesSlot});

  final List<OverAggregate> overs;
  final int seriesSlot;

  @override
  State<ManhattanChart> createState() => _ManhattanChartState();
}

class _ManhattanChartState extends State<ManhattanChart> {
  int? _selected;

  @override
  Widget build(BuildContext context) {
    if (widget.overs.isEmpty) {
      return const Padding(padding: EdgeInsets.all(16), child: Text('No overs bowled yet.'));
    }
    final maxRuns = widget.overs.map((o) => o.runs).fold(0, (a, b) => a > b ? a : b);
    final color = ChartPalette.categorical(widget.seriesSlot, Theme.of(context).brightness);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 160,
          child: LayoutBuilder(
            builder: (context, constraints) {
              return GestureDetector(
                onTapDown: (details) {
                  final barWidth = constraints.maxWidth / widget.overs.length;
                  final index = (details.localPosition.dx / barWidth).floor().clamp(0, widget.overs.length - 1);
                  setState(() => _selected = _selected == index ? null : index);
                },
                child: CustomPaint(
                  size: Size(constraints.maxWidth, 160),
                  painter: _ManhattanPainter(
                    overs: widget.overs,
                    maxRuns: maxRuns == 0 ? 1 : maxRuns,
                    barColor: color,
                    wicketColor: ChartPalette.statusCritical,
                    gridColor: ChartPalette.gridline(context),
                    labelColor: ChartPalette.mutedInk(context),
                    selected: _selected,
                  ),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 4),
        Text(
          _selected != null
              ? 'Over ${widget.overs[_selected!].overNumber + 1}: ${widget.overs[_selected!].runs} run(s)'
                  '${widget.overs[_selected!].wickets > 0 ? ', ${widget.overs[_selected!].wickets} wicket(s)' : ''}'
              : 'Tap a bar for details',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}

class _ManhattanPainter extends CustomPainter {
  _ManhattanPainter({
    required this.overs,
    required this.maxRuns,
    required this.barColor,
    required this.wicketColor,
    required this.gridColor,
    required this.labelColor,
    required this.selected,
  });

  final List<OverAggregate> overs;
  final int maxRuns;
  final Color barColor;
  final Color wicketColor;
  final Color gridColor;
  final Color labelColor;
  final int? selected;

  @override
  void paint(Canvas canvas, Size size) {
    const bottomAxis = 18.0;
    final chartHeight = size.height - bottomAxis;
    final barSlot = size.width / overs.length;
    final barWidth = (barSlot * 0.6).clamp(2.0, 28.0);

    final gridPaint = Paint()
      ..color = gridColor
      ..strokeWidth = 1;
    for (var i = 0; i <= 2; i++) {
      final y = chartHeight - (chartHeight * i / 2);
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    for (var i = 0; i < overs.length; i++) {
      final o = overs[i];
      final barHeight = chartHeight * (o.runs / maxRuns);
      final x = i * barSlot + (barSlot - barWidth) / 2;
      final rect = RRect.fromRectAndCorners(
        Rect.fromLTWH(x, chartHeight - barHeight, barWidth, barHeight),
        topLeft: const Radius.circular(3),
        topRight: const Radius.circular(3),
      );
      final paint = Paint()..color = selected == i ? barColor : barColor.withValues(alpha: 0.85);
      canvas.drawRRect(rect, paint);

      if (o.wickets > 0) {
        canvas.drawCircle(Offset(x + barWidth / 2, chartHeight - barHeight - 6), 3, Paint()..color = wicketColor);
      }

      final tp = TextPainter(
        text: TextSpan(text: '${o.overNumber + 1}', style: TextStyle(color: labelColor, fontSize: 10)),
        textDirection: TextDirection.ltr,
      )..layout();
      if (overs.length <= 30 || i % 2 == 0) {
        tp.paint(canvas, Offset(x + barWidth / 2 - tp.width / 2, size.height - bottomAxis + 2));
      }
    }
  }

  @override
  bool shouldRepaint(covariant _ManhattanPainter oldDelegate) =>
      oldDelegate.overs != overs || oldDelegate.selected != selected;
}
