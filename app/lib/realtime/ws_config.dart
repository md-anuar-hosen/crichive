const _apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:3000');

String get wsBaseUrl => _apiBaseUrl.replaceFirst('https://', 'wss://').replaceFirst('http://', 'ws://');
