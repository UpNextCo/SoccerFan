import Foundation

enum LastManStandingSeed {
    /// Build the daily prompt from the server-generated puzzle. nil when malformed.
    static func makeServerPrompt(from dto: LastManStandingPuzzleDTO) -> LMSPrompt? {
        let questions = dto.questions.compactMap { q -> LMSQuestion? in
            guard q.options.count >= 2 else { return nil }
            return LMSQuestion(
                id: q.id,
                prompt: q.prompt,
                options: q.options.map { LMSOption(id: $0.id, label: $0.label) }
            )
        }
        guard questions.count == LMSGameState.totalQuestions else { return nil }
        return LMSPrompt(id: dto.puzzleId, date: dto.date, questions: questions)
    }
}
