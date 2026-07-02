import Foundation

/// Battle Mode share-card copy. The daily challenge itself is always server-generated
/// (battleGenerator.ts) — there is deliberately no offline fallback puzzle.
enum BattleSeed {
    static func shareText(challenge: BattleChallenge, result: BattleResult) -> String {
        [
            "Ball Knowledge — Battle Mode",
            challenge.category.title,
            "\(result.verdict) · \(result.percentage)% of the perfect XI",
            "\(result.yourTotal) / \(result.optimalScore) \(challenge.category.noun)",
            "",
            "Can you build a better XI?",
        ].joined(separator: "\n")
    }
}
