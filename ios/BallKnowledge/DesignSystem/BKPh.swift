import SwiftUI

/// Lightweight local Phosphor subset — same API surface we use, without the 9k-icon SPM package.
public enum Ph: String {
    case house
    case soccerBall = "soccer-ball"
    case calendar
    case chartBar = "chart-bar"
    case userCircle = "user-circle"
    case lightning
    case trophy
    case bell
    case fire
    case coins
    case checkCircle = "check-circle"
    case arrowRight = "arrow-right"
    case users
    case play
    case gift
    case gameController = "game-controller"
    case x
    case xCircle = "x-circle"
    case sealQuestion = "seal-question"
    case caretRight = "caret-right"
    case target
    case strategy
    case link
    case listNumbers = "list-numbers"
    case squaresFour = "squares-four"
    case flag
}

public extension Ph {
    enum IconWeight: String, CaseIterable, Identifiable {
        public var id: Self { self }

        case regular
        case thin
        case light
        case bold
        case fill
        case duotone
    }

    var regular: Image { Self.icon(rawValue) }
    var thin: Image { Self.icon("\(rawValue)-thin") }
    var light: Image { Self.icon("\(rawValue)-light") }
    var bold: Image { Self.icon("\(rawValue)-bold") }
    var fill: Image { Self.icon("\(rawValue)-fill") }
    var duotone: Image { Self.icon("\(rawValue)-duotone") }

    func weight(_ weight: IconWeight) -> Image {
        switch weight {
        case .regular: return regular
        case .thin: return thin
        case .light: return light
        case .bold: return bold
        case .fill: return fill
        case .duotone: return duotone
        }
    }

    private static func icon(_ name: String) -> Image {
        Image(name)
            .interpolation(.medium)
            .resizable()
    }
}

struct ColorBlended: ViewModifier {
    fileprivate var color: Color

    func body(content: Content) -> some View {
        VStack {
            ZStack {
                content
                color.blendMode(.sourceAtop)
            }
            .drawingGroup(opaque: false)
        }
    }
}

public extension View {
    func color(_ color: Color) -> some View {
        modifier(ColorBlended(color: color))
    }
}
