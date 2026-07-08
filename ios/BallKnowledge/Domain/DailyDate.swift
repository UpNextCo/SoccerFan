import Foundation

/// User-local calendar day for NYT-style dailies — puzzles roll at local midnight.
enum DailyDate {
    private static var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        return cal
    }

    private static var formatter: DateFormatter {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }

    static func localToday(from date: Date = .now) -> String {
        formatter.string(from: date)
    }

    static func localYesterday(from date: Date = .now) -> String {
        guard let yesterday = calendar.date(byAdding: .day, value: -1, to: date) else {
            return localToday(from: date)
        }
        return formatter.string(from: yesterday)
    }

    static func acceptableSyncDates(from date: Date = .now) -> Set<String> {
        [localToday(from: date), localYesterday(from: date)]
    }

    static func secondsUntilLocalMidnight(from date: Date = .now) -> TimeInterval {
        let start = calendar.startOfDay(for: date)
        guard let next = calendar.date(byAdding: .day, value: 1, to: start) else { return 0 }
        return max(0, next.timeIntervalSince(date))
    }

    static func displayDate(from dateString: String) -> Date? {
        formatter.date(from: dateString)
    }
}
