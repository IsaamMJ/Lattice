// bad.dart — every executable line below must be flagged.

Future<void> a() async {
  final r = await http.get(Uri.parse("https://api.example.com/data")); // SHOULD flag
  print(r.body);
}

Future<void> b() async {
  await http.post(Uri.parse("https://api.example.com/users"), body: payload); // SHOULD flag
}

Future<void> c() async {
  final res = await dio.get("https://api.example.com/x"); // SHOULD flag
  return res.data;
}
