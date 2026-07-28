class User {
  const User({required this.id, required this.email, required this.displayName, required this.isPlatformAdmin});

  final String id;
  final String email;
  final String displayName;
  final bool isPlatformAdmin;

  factory User.fromJson(Map<String, dynamic> json) => User(
        id: json['id'] as String,
        email: json['email'] as String,
        displayName: json['display_name'] as String,
        isPlatformAdmin: json['is_platform_admin'] as bool? ?? false,
      );
}
