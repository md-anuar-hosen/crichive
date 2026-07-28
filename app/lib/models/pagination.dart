class PageInfo {
  const PageInfo({required this.page, required this.limit, required this.total, required this.totalPages});

  final int page;
  final int limit;
  final int total;
  final int totalPages;

  factory PageInfo.fromJson(Map<String, dynamic> json) => PageInfo(
        page: json['page'] as int,
        limit: json['limit'] as int,
        total: json['total'] as int,
        totalPages: json['total_pages'] as int,
      );
}

class Paginated<T> {
  const Paginated({required this.data, required this.pageInfo});

  final List<T> data;
  final PageInfo pageInfo;

  factory Paginated.fromJson(Map<String, dynamic> json, T Function(Map<String, dynamic>) fromJson) => Paginated(
        data: (json['data'] as List).cast<Map<String, dynamic>>().map(fromJson).toList(),
        pageInfo: PageInfo.fromJson(json['pagination'] as Map<String, dynamic>),
      );
}
