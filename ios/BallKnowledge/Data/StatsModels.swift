import Foundation

/// Backend `StatMetric` values (`GET /stats/top`, career stat totals).
enum CareerStatMetric: String, CaseIterable, Codable, Sendable {
    case goals
    case assists
    case appearances
    case yellowCards
    case redCards
    case minutes
    case cleanSheets
    case saves
    case foulsCommitted
    case tackles
}

struct TopStatPlayerDTO: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let club: String
    let league: String
    let nationality: String
    let position: String
    let statValue: Int
}
