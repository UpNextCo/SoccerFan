import Foundation

enum FootballGolfMatcher {
    static func grade(
        hole: FootballGolfHole,
        submittedAnswers: [String]
    ) -> (matched: [String], correctCount: Int) {
        var matched: [String] = []
        var usedCanonical: Set<String> = []

        for raw in submittedAnswers {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }

            guard let canonical = matchCanonicalAnswer(trimmed, hole: hole) else { continue }
            guard !usedCanonical.contains(canonical) else { continue }

            usedCanonical.insert(canonical)
            matched.append(displayName(for: canonical, hole: hole))
        }

        return (matched, matched.count)
    }

    private static func matchCanonicalAnswer(_ input: String, hole: FootballGolfHole) -> String? {
        let normalizedInput = normalize(input)

        for answer in hole.correctAnswers {
            if matches(normalizedInput, canonical: answer, aliases: hole.aliases[answer] ?? []) {
                return normalize(answer)
            }
        }
        return nil
    }

    private static func matches(_ input: String, canonical: String, aliases: [String]) -> Bool {
        let normalizedCanonical = normalize(canonical)
        if input == normalizedCanonical { return true }

        for alias in aliases where normalize(alias) == input {
            return true
        }

        if normalizedCanonical.contains(" ") {
            let last = normalizedCanonical.split(separator: " ").last.map(String.init) ?? normalizedCanonical
            if input == last && last.count >= 4 { return true }
        }

        return false
    }

    private static func displayName(for normalizedCanonical: String, hole: FootballGolfHole) -> String {
        hole.correctAnswers.first { normalize($0) == normalizedCanonical } ?? normalizedCanonical
    }

    private static func normalize(_ value: String) -> String {
        value
            .lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^a-z0-9 ]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
